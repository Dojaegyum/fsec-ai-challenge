#!/usr/bin/env python3
"""오라클 무료 서버를 잡는다 — 네트워크를 세우고, 자리가 날 때까지 두드린다.

정본: docs/plans/08-24-oracle-account-handoff.md
근거: ADR-028(모델은 앱 밖) · ADR-043(개발은 빌린 GPU · 운영은 국내)

## 왜 스크립트인가

`VM.Standard.A1.Flex`(ARM 2코어·12GB)는 **영구 무료인데 늘 자리가 없습니다.**
오사카 계정으로 19시간 · 394번을 두드려 한 번도 못 잡았습니다. 사람이 콘솔을
누르고 있을 일이 아닙니다.

**자리는 가용성 도메인마다 따로입니다.** 애슈번은 도메인이 셋이라 한 바퀴에
세 번 두드릴 수 있습니다 — 도메인이 하나뿐인 오사카에서 못 하던 것입니다.

## 화면으로 하면 밟는 함정을 여기선 안 밟습니다

핸드오프 문서의 「직접 겪은 함정」은 **전부 화면의 함정**입니다 — `Create VCN`
버튼이 껍데기만 만드는 것, ARM 이 `Ampere` 탭에 숨어 있는 것, 크기 기본값이
무료 한도의 절반인 것. 값을 명령에 직접 쓰면 만날 일이 없습니다.

## 쓰는 법

    python oci_provision.py network    # VCN·서브넷·포트 (여러 번 돌려도 안전)
    python oci_provision.py grab       # 자리가 날 때까지 두드림
    python oci_provision.py status     # 지금 뭐가 서 있나

`~/.oci/config` 의 `DEFAULT` 프로필을 씁니다.
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass

try:
    import oci
except ImportError:
    sys.exit("oci SDK 가 없습니다:  python -m pip install oci-cli")

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8")

# ─────────────────────────────────────────────────────────────────────────────
# 설정 — 핸드오프 문서 §③ 의 값과 같아야 합니다
# ─────────────────────────────────────────────────────────────────────────────

VCN_NAME = "finally-net"
SUBNET_NAME = "finally-net-public"
INSTANCE_NAME = "finally-transcriber"

VCN_CIDR = "10.0.0.0/16"
SUBNET_CIDR = "10.0.0.0/24"

SHAPE = "VM.Standard.A1.Flex"

# 큰 것부터. **작은 것이 남은 자투리에 들어갈 때가 있어** 둘 다 시도합니다.
# 2코어·12GB 가 무료 한도 전부이고, 3코어부터 요금이 붙습니다.
SHAPE_TRIES = ((2, 12), (1, 6))

OS_NAME = "Canonical Ubuntu"
OS_VERSION = "24.04"

# 서비스가 쓰는 통로. 22 는 기본 보안 목록에 이미 있습니다
OPEN_PORTS = (80, 443)

ROUND_SLEEP_SEC = 180

# 자리가 없다는 뜻의 응답. **고장이 아니라 재고 없음**이라 계속 돕니다.
#
# ⚠️ **`InternalError` 를 여기 넣지 않습니다.** 오라클은 재고가 없을 때도 코드를
# `InternalError`(500)로 주는데, 그건 진짜 서버 오류와 코드가 겹칩니다. 코드만
# 보고 삼키면 고칠 수 있는 실패(한도·권한·잘못된 값)를 몇 시간씩 재시도하게
# 됩니다 — 문서가 말한 「19시간 394번」이 그렇게 새는 모양입니다.
# 그래서 **본문에 capacity 가 있는지**로 가릅니다. 아래 `try_launch` 참고.
CAPACITY_CODES = {"OutOfHostCapacity", "OutOfCapacity"}


@dataclass(frozen=True)
class Ctx:
    config: dict
    identity: "oci.identity.IdentityClient"
    network: "oci.core.VirtualNetworkClient"
    compute: "oci.core.ComputeClient"
    tenancy: str


def connect() -> Ctx:
    config = oci.config.from_file()
    oci.config.validate_config(config)
    tenancy = config["tenancy"]
    return Ctx(
        config=config,
        identity=oci.identity.IdentityClient(config),
        network=oci.core.VirtualNetworkClient(config),
        compute=oci.core.ComputeClient(config),
        tenancy=tenancy,
    )


def say(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')}  {msg}", flush=True)


# ─────────────────────────────────────────────────────────────────────────────
# 네트워크 — 여러 번 돌려도 같은 결과여야 합니다
# ─────────────────────────────────────────────────────────────────────────────


def find_vcn(ctx: Ctx):
    for vcn in oci.pagination.list_call_get_all_results(
        ctx.network.list_vcns, ctx.tenancy
    ).data:
        if vcn.display_name == VCN_NAME and vcn.lifecycle_state == "AVAILABLE":
            return vcn
    return None


def find_subnet(ctx: Ctx, vcn_id: str):
    for sub in oci.pagination.list_call_get_all_results(
        ctx.network.list_subnets, ctx.tenancy, vcn_id=vcn_id
    ).data:
        if sub.lifecycle_state == "AVAILABLE" and not sub.prohibit_public_ip_on_vnic:
            return sub
    return None


def ensure_network(ctx: Ctx):
    """VCN · 인터넷 게이트웨이 · 경로 · 포트 · 공개 서브넷.

    **화면의 `Create VCN` 버튼이 만드는 껍데기와 다릅니다** — 게이트웨이와
    경로까지 붙여야 인터넷에서 닿습니다. 그것이 문서가 마법사를 쓰라고 한 이유고,
    여기서는 그 조각을 직접 만듭니다.
    """
    vcn = find_vcn(ctx)
    if vcn is None:
        say(f"VCN 만드는 중 — {VCN_NAME} ({VCN_CIDR})")
        vcn = ctx.network.create_vcn(
            oci.core.models.CreateVcnDetails(
                compartment_id=ctx.tenancy,
                cidr_block=VCN_CIDR,
                display_name=VCN_NAME,
                dns_label="finallynet",
            )
        ).data
        oci.wait_until(
            ctx.network,
            ctx.network.get_vcn(vcn.id),
            "lifecycle_state",
            "AVAILABLE",
            max_wait_seconds=300,
        )
    else:
        say(f"VCN 이미 있음 — {vcn.display_name}")

    # 인터넷 게이트웨이
    gateways = ctx.network.list_internet_gateways(ctx.tenancy, vcn_id=vcn.id).data
    igw = next((g for g in gateways if g.lifecycle_state == "AVAILABLE"), None)
    if igw is None:
        say("인터넷 게이트웨이 만드는 중")
        igw = ctx.network.create_internet_gateway(
            oci.core.models.CreateInternetGatewayDetails(
                compartment_id=ctx.tenancy,
                vcn_id=vcn.id,
                is_enabled=True,
                display_name=f"{VCN_NAME}-igw",
            )
        ).data
    else:
        say("인터넷 게이트웨이 이미 있음")

    # 기본 경로표에 바깥으로 나가는 길
    rt = ctx.network.get_route_table(vcn.default_route_table_id).data
    if not any(r.network_entity_id == igw.id for r in rt.route_rules):
        say("바깥으로 나가는 경로 추가")
        ctx.network.update_route_table(
            rt.id,
            oci.core.models.UpdateRouteTableDetails(
                route_rules=list(rt.route_rules)
                + [
                    oci.core.models.RouteRule(
                        destination="0.0.0.0/0",
                        destination_type="CIDR_BLOCK",
                        network_entity_id=igw.id,
                    )
                ]
            ),
        )
    else:
        say("경로 이미 있음")

    # 포트 — 마법사는 22 만 열어 둡니다
    sl = ctx.network.get_security_list(vcn.default_security_list_id).data
    have = {
        r.tcp_options.destination_port_range.min
        for r in sl.ingress_security_rules
        if r.tcp_options and r.tcp_options.destination_port_range
    }
    missing = [p for p in OPEN_PORTS if p not in have]
    if missing:
        say(f"포트 여는 중 — {', '.join(str(p) for p in missing)}")
        ctx.network.update_security_list(
            sl.id,
            oci.core.models.UpdateSecurityListDetails(
                ingress_security_rules=list(sl.ingress_security_rules)
                + [
                    oci.core.models.IngressSecurityRule(
                        protocol="6",  # TCP
                        source="0.0.0.0/0",
                        is_stateless=False,
                        tcp_options=oci.core.models.TcpOptions(
                            destination_port_range=oci.core.models.PortRange(
                                min=p, max=p
                            )
                        ),
                    )
                    for p in missing
                ]
            ),
        )
    else:
        say("포트 이미 열려 있음")

    # 공개 서브넷
    subnet = find_subnet(ctx, vcn.id)
    if subnet is None:
        say(f"공개 서브넷 만드는 중 — {SUBNET_CIDR}")
        subnet = ctx.network.create_subnet(
            oci.core.models.CreateSubnetDetails(
                compartment_id=ctx.tenancy,
                vcn_id=vcn.id,
                cidr_block=SUBNET_CIDR,
                display_name=SUBNET_NAME,
                dns_label="public",
                prohibit_public_ip_on_vnic=False,
            )
        ).data
    else:
        say(f"공개 서브넷 이미 있음 — {subnet.display_name}")

    return vcn, subnet


# ─────────────────────────────────────────────────────────────────────────────
# 자리 두드리기
# ─────────────────────────────────────────────────────────────────────────────


def pick_image(ctx: Ctx) -> "oci.core.models.Image":
    """이 크기에서 도는 우분투 중 가장 최근 것.

    **크기로 걸러서 받습니다.** 화면에서는 ARM 용 이미지가 `aarch64` 라는
    이름으로 따로 보여 헷갈리는데, 크기를 주면 오라클이 맞는 것만 돌려줍니다.
    """
    images = ctx.compute.list_images(
        ctx.tenancy,
        operating_system=OS_NAME,
        operating_system_version=OS_VERSION,
        shape=SHAPE,
        sort_by="TIMECREATED",
        sort_order="DESC",
        lifecycle_state="AVAILABLE",
    ).data
    if not images:
        sys.exit(f"{OS_NAME} {OS_VERSION} 이미지를 못 찾았습니다 ({SHAPE})")
    return images[0]


def running_instance(ctx: Ctx):
    for inst in oci.pagination.list_call_get_all_results(
        ctx.compute.list_instances, ctx.tenancy
    ).data:
        if inst.display_name == INSTANCE_NAME and inst.lifecycle_state in (
            "RUNNING",
            "PROVISIONING",
            "STARTING",
        ):
            return inst
    return None


def public_ip_of(ctx: Ctx, instance_id: str) -> str | None:
    attachments = ctx.compute.list_vnic_attachments(
        ctx.tenancy, instance_id=instance_id
    ).data
    for att in attachments:
        if att.lifecycle_state != "ATTACHED":
            continue
        vnic = ctx.network.get_vnic(att.vnic_id).data
        if vnic.public_ip:
            return vnic.public_ip
    return None


def try_launch(ctx: Ctx, ad_name: str, subnet_id: str, image_id: str,
               ocpus: int, mem: int, ssh_key: str) -> tuple[bool, str]:
    """한 번 두드린다. `(잡았나, 사유)`."""
    details = oci.core.models.LaunchInstanceDetails(
        compartment_id=ctx.tenancy,
        availability_domain=ad_name,
        display_name=INSTANCE_NAME,
        shape=SHAPE,
        shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(
            ocpus=ocpus, memory_in_gbs=mem
        ),
        source_details=oci.core.models.InstanceSourceViaImageDetails(image_id=image_id),
        create_vnic_details=oci.core.models.CreateVnicDetails(
            subnet_id=subnet_id, assign_public_ip=True
        ),
        metadata={"ssh_authorized_keys": ssh_key},
    )
    try:
        inst = ctx.compute.launch_instance(details).data
        return True, inst.id
    except oci.exceptions.ServiceError as e:
        if e.code in CAPACITY_CODES or "capacity" in (e.message or "").lower():
            return False, "자리 없음"
        if e.status == 429:
            return False, "너무 자주 물음 (429)"
        # ⚠️ **재고 없음이 아닌 것은 계속 두드려도 안 풀립니다.**
        # 한도 초과·권한 없음·잘못된 값을 재고 문제로 삼키면 몇 시간을 버립니다
        raise


def grab(ctx: Ctx, ssh_key: str, once: bool = False) -> int:
    existing = running_instance(ctx)
    if existing:
        ip = public_ip_of(ctx, existing.id)
        say(f"이미 서 있습니다 — {existing.lifecycle_state} · {ip or '주소 준비 중'}")
        return 0

    vcn = find_vcn(ctx)
    if vcn is None:
        sys.exit("네트워크가 없습니다. 먼저:  python oci_provision.py network")
    subnet = find_subnet(ctx, vcn.id)
    if subnet is None:
        sys.exit("공개 서브넷이 없습니다. 먼저:  python oci_provision.py network")

    ads = [a.name for a in ctx.identity.list_availability_domains(ctx.tenancy).data]
    image = pick_image(ctx)
    say(f"도메인 {len(ads)}개 × 크기 {len(SHAPE_TRIES)}가지 = 한 바퀴 {len(ads) * len(SHAPE_TRIES)}번")
    say(f"이미지 — {image.display_name}")

    attempt = 0
    while True:
        for ad in ads:
            for ocpus, mem in SHAPE_TRIES:
                attempt += 1
                got, info = try_launch(ctx, ad, subnet.id, image.id, ocpus, mem, ssh_key)
                if got:
                    say(f"★ 잡았습니다 — {ad} · {ocpus}코어 {mem}GB")
                    say(f"  인스턴스 {info}")
                    return wait_and_report(ctx, info)
                say(f"{attempt:>5}번째  {ad.split(':')[-1]} {ocpus}코어{mem}GB → {info}")
                if "429" in info:
                    time.sleep(30)
        if once:
            return 1
        say(f"한 바퀴 끝. {ROUND_SLEEP_SEC // 60}분 뒤 다시")
        time.sleep(ROUND_SLEEP_SEC)


def wait_and_report(ctx: Ctx, instance_id: str) -> int:
    say("서버가 뜨기를 기다립니다 (1~2분)")
    oci.wait_until(
        ctx.compute,
        ctx.compute.get_instance(instance_id),
        "lifecycle_state",
        "RUNNING",
        max_wait_seconds=900,
    )
    ip = None
    for _ in range(30):
        ip = public_ip_of(ctx, instance_id)
        if ip:
            break
        time.sleep(5)
    say(f"★ 주소 — {ip}")
    print()
    print("다음 두 줄로 서비스를 올립니다:")
    print(f"  scp -r services/transcriber ubuntu@{ip}:~/")
    print(f'  ssh ubuntu@{ip} "cd transcriber && bash bootstrap.sh"')
    print()
    print("⚠️ 주소를 고정하세요 — 기본값은 재시작하면 바뀝니다.")
    print("   콘솔 → 인스턴스 → Public IP 옆 Edit → Reserved public IP")
    return 0


def primary_private_ip(ctx: Ctx, instance_id: str):
    att = [
        a
        for a in ctx.compute.list_vnic_attachments(ctx.tenancy, instance_id=instance_id).data
        if a.lifecycle_state == "ATTACHED"
    ][0]
    return [p for p in ctx.network.list_private_ips(vnic_id=att.vnic_id).data if p.is_primary][0]


def reserve_ip(ctx: Ctx) -> int:
    """임시 주소를 예약 주소로 바꾼다.

    ⚠️ **주소가 바뀝니다.** 오라클은 「같은 값을 그대로 고정」을 지원하지 않습니다 —
    임시(ephemeral)를 떼고 예약(reserved)을 새로 붙이는 것뿐이라, 새 주소는
    오라클 풀에서 나옵니다. 그래서 이 명령을 **서비스를 올리기 전에** 씁니다.
    올린 뒤에 하면 도메인과 인증서를 다시 잡아야 합니다.

    기본값(임시)을 그대로 두면 **서버를 재시작할 때마다 주소가 바뀝니다.**
    """
    inst = running_instance(ctx)
    if inst is None:
        sys.exit("인스턴스가 없습니다.")
    priv = primary_private_ip(ctx, inst.id)
    pub = ctx.network.get_public_ip_by_private_ip_id(
        oci.core.models.GetPublicIpByPrivateIpIdDetails(private_ip_id=priv.id)
    ).data

    say(f"지금 주소 — {pub.ip_address} ({pub.lifetime})")
    if pub.lifetime == "RESERVED":
        say("이미 예약 주소입니다. 할 일이 없습니다")
        return 0

    say("임시 주소를 뗍니다 — 잠깐 밖에서 안 닿습니다")
    ctx.network.delete_public_ip(pub.id)
    for _ in range(30):
        try:
            ctx.network.get_public_ip_by_private_ip_id(
                oci.core.models.GetPublicIpByPrivateIpIdDetails(private_ip_id=priv.id)
            )
            time.sleep(3)
        except oci.exceptions.ServiceError as e:
            if e.status == 404:
                break
            raise

    say("예약 주소를 붙입니다")
    new = ctx.network.create_public_ip(
        oci.core.models.CreatePublicIpDetails(
            compartment_id=ctx.tenancy,
            lifetime="RESERVED",
            private_ip_id=priv.id,
            display_name=f"{INSTANCE_NAME}-ip",
        )
    ).data
    for _ in range(40):
        new = ctx.network.get_public_ip(new.id).data
        if new.lifecycle_state == "ASSIGNED" and new.ip_address:
            break
        time.sleep(3)

    say(f"★ 새 주소 — {new.ip_address} ({new.lifetime})")
    print()
    print("⚠️ 주소가 바뀌었습니다. 따라 바꿔야 하는 곳:")
    print(f"  src/.env.local        TRANSCRIBER_URL=https://{new.ip_address.replace('.', '-')}.sslip.io")
    print(f"  서버의 .env           TRANSCRIBER_DOMAIN={new.ip_address.replace('.', '-')}.sslip.io")
    print(f"  접속                  ssh ubuntu@{new.ip_address}")
    return 0


def status(ctx: Ctx) -> int:
    say(f"테넌시 {ctx.tenancy[:24]}… · 지역 {ctx.config['region']}")
    ads = ctx.identity.list_availability_domains(ctx.tenancy).data
    say(f"가용성 도메인 {len(ads)}개 — {', '.join(a.name.split(':')[-1] for a in ads)}")
    vcn = find_vcn(ctx)
    say(f"VCN — {vcn.display_name if vcn else '없음'}")
    if vcn:
        sub = find_subnet(ctx, vcn.id)
        say(f"공개 서브넷 — {sub.display_name if sub else '없음'}")
    inst = running_instance(ctx)
    if inst:
        say(f"인스턴스 — {inst.lifecycle_state} · {public_ip_of(ctx, inst.id) or '주소 없음'}")
    else:
        say("인스턴스 — 없음")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="오라클 무료 서버 준비")
    ap.add_argument("command", choices=["network", "grab", "reserve", "status"])
    ap.add_argument("--ssh-key", help="공개키 문자열 또는 .pub 경로")
    ap.add_argument("--once", action="store_true", help="한 바퀴만 돌고 끝냅니다")
    args = ap.parse_args()

    ctx = connect()

    if args.command == "status":
        return status(ctx)
    if args.command == "network":
        ensure_network(ctx)
        say("네트워크 준비 끝")
        return 0
    if args.command == "reserve":
        return reserve_ip(ctx)

    if not args.ssh_key:
        sys.exit("--ssh-key 가 필요합니다 (서버에 들어갈 공개키)")
    key = args.ssh_key
    if not key.startswith("ssh-"):
        with open(key, encoding="utf-8") as f:
            key = f.read().strip()
    return grab(ctx, key, once=args.once)


if __name__ == "__main__":
    sys.exit(main())
