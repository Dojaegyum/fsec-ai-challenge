/* phase-transitions.jsx — S-06 챗 ↔ 패널 ↔ 보드 국면 전환 모션 스터디 */
const { CompositionStage, useComposition, Captions, Easing, animate, clamp } = window;
const { useTweaks, TweaksPanel, TweakSection, TweakToggle } = window;
const R = React;

const C = {
  ground: '#000', stage: 'oklch(0.16 0.004 285.9)', surface: 'oklch(0.231 0 89.9)',
  hair: 'oklch(0.305 0.013 267.1 / 52%)', ink1: '#fff', ink2: 'oklch(0.845 0.009 271.3)',
  ink3: 'oklch(0.714 0.019 261.3)', icon: 'oklch(0.609 0.008 260.7)',
  pii: 'oklch(0.697 0.16 258.2)', piiBg: 'oklch(0.231 0.047 259.1)',
  amber: 'oklch(0.77 0.117 70.9)',
};
const F = "'Pretendard Variable',Pretendard,system-ui,sans-serif";

/* 모션 헬퍼 셋 — 이 셋 밖에서 이징을 쓰지 않는다 */
const MOTION = {
  enter: (T, at) => { // at<0이면 첫 프레임부터 보임 (루프 이음새용)
    const p = at < 0 ? 1 : animate({ from: 0, to: 1, start: at, end: at + 0.5, ease: Easing.easeOutCubic })(T);
    return { opacity: p, transform: `translateY(${(1 - p) * 10}px)` };
  },
  move: (T, a, b) => animate({ from: 0, to: 1, start: a, end: b, ease: Easing.easeInOutCubic })(T),
  pop: (T, at) => {
    const p = animate({ from: 0, to: 1, start: at, end: at + 0.45, ease: Easing.easeOutBack })(T);
    return { opacity: clamp(p * 2, 0, 1), transform: `scale(${0.9 + 0.1 * p})` };
  },
};
const lerp = (a, b, m) => a + (b - a) * m;

function Bubble({ me, children, style }) {
  return (
    <div style={{
      maxWidth: me ? '52%' : '62%', marginLeft: me ? 'auto' : 0,
      padding: '13px 16px', fontSize: 15.5, lineHeight: 1.6, fontFamily: F,
      borderRadius: me ? '15px 15px 5px 15px' : '15px 15px 15px 5px',
      background: me ? 'oklch(1 0 0 / 11%)' : C.surface,
      border: me ? 'none' : `1px solid ${C.hair}`, color: me ? C.ink1 : C.ink2, ...style,
    }}>{children}</div>
  );
}
const Tok = ({ children }) => (
  <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 6, background: C.piiBg, border: `1px solid oklch(0.697 0.16 258.2 / 36%)`, color: C.pii, fontSize: 13.5 }}>{children}</span>
);
const Chip = ({ amber, children }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 999, padding: '4px 11px',
    fontSize: 13, fontFamily: F, whiteSpace: 'nowrap',
    border: `1px solid ${amber ? 'oklch(0.77 0.117 70.9 / 45%)' : C.hair}`,
    background: amber ? 'oklch(0.77 0.117 70.9 / 10%)' : 'oklch(1 0 0 / 4%)',
    color: amber ? C.amber : C.ink3, fontVariantNumeric: 'tabular-nums',
  }}>{children}</span>
);

function ChatContent({ T }) { // 폭 980 기준으로 그려지는 챗 내부
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '36px 28px 20px', fontFamily: F }}>
      <div style={{ display: 'grid', gap: 12, alignContent: 'start', flex: 1 }}>
        <div style={MOTION.enter(T, -1)}><Bubble>무슨 일이 있으셨는지 편하게 적어주세요. 문장이 아니어도 됩니다.</Bubble></div>
        <div style={MOTION.enter(T, -1)}><Bubble me>아까 검찰이라면서 전화가 와서 3백만원을 보냈어요</Bubble></div>
        <div style={MOTION.enter(T, -1)}>
          <Bubble><Tok>금액·1</Tok>을 보내셨군요 — 가려진 채로만 처리됩니다.<br /><b style={{ color: C.ink1, fontWeight: 640 }}>돈이 어떻게 나갔나요?</b></Bubble>
        </div>
        <div style={{ display: 'flex', gap: 8, ...MOTION.enter(T, -1) }}>
          {['계좌로 이체했어요', '간편송금 앱으로', '기억이 안 나요'].map((s, i) => (
            <span key={s} style={{
              display: 'inline-flex', alignItems: 'center', gap: 9, minHeight: 46, padding: '10px 16px',
              borderRadius: 12, border: `1px solid ${C.hair}`, background: 'oklch(1 0 0 / 4%)',
              fontSize: 14.5, color: i === 2 ? C.ink3 : C.ink2, whiteSpace: 'nowrap',
            }}><span style={{ color: C.icon }}>○</span>{s}</span>
          ))}
        </div>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 52,
        borderRadius: 14, border: '1px solid oklch(0.697 0.16 258.2 / 45%)', background: C.surface,
        boxShadow: '0 0 0 3px oklch(0.697 0.16 258.2 / 10%)', padding: '0 16px',
      }}>
        <span style={{ fontSize: 14, color: 'oklch(0.65 0 89.9)' }}>직접 적으셔도 됩니다</span>
        <span style={{ width: 30, height: 30, borderRadius: 999, background: '#fff', color: '#000', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700 }}>↑</span>
      </div>
    </div>
  );
}

function PanelContent({ T, at }) {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: 18, fontFamily: F }}>
      <div style={{ fontSize: 11.5, letterSpacing: '.12em', color: C.icon, marginBottom: 10 }}>워크스페이스</div>
      <div style={{
        borderRadius: 14, border: '1px solid oklch(0.697 0.16 258.2 / 34%)', padding: '14px 15px',
        background: 'linear-gradient(180deg, oklch(0.245 0.02 268), oklch(0.2 0.012 268))', ...MOTION.enter(T, at),
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 620, letterSpacing: '.13em', color: C.pii }}>외부 이동</div>
            <div style={{ fontSize: 15, fontWeight: 640, color: C.ink1, marginTop: 3 }}>국민은행 앱에서 신청</div>
          </div>
          <Chip amber>D-2</Chip>
        </div>
        <div style={{ borderRadius: 10, border: `1px solid ${C.hair}`, background: C.surface, padding: '11px 12px', ...MOTION.enter(T, at + 0.12) }}>
          <div style={{ fontSize: 12.5, color: C.icon }}>돌아오실 때 들고 오세요</div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink1, marginTop: 4 }}>◆ 접수증 (PDF 또는 캡처)</div>
        </div>
        <div style={{ display: 'grid', gap: 7, marginTop: 10, ...MOTION.enter(T, at + 0.24) }}>
          <span style={{ display: 'inline-flex', minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: '#fff', fontSize: 13.5, fontWeight: 660, color: '#000' }}>국민은행 앱 열기 ↗</span>
          <span style={{ display: 'inline-flex', minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: `1px solid ${C.hair}`, background: 'oklch(1 0 0 / 4%)', fontSize: 13.5, fontWeight: 560, color: C.ink2 }}>나중에 할게요</span>
        </div>
      </div>
    </div>
  );
}

function BoardContent({ T, at }) {
  const rows = [
    ['✓', '국민은행에 지급정지 요청', '◆ 증빙됨', C.pii],
    ['✓', '112 신고 — 접수번호 기록됨', '◆ 증빙됨', C.pii],
    ['→', '피해구제 신청서 제출', 'D-2', C.amber],
    ['○', '접수증 올리기', '미시작', C.ink3],
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '20px 28px', fontFamily: F }}>
      <div style={{
        borderRadius: 13, border: '1px solid oklch(0.77 0.117 70.9 / 45%)', background: 'oklch(0.77 0.117 70.9 / 6%)',
        padding: '15px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, ...MOTION.enter(T, at),
      }}>
        <div>
          <div style={{ fontSize: 12.5, color: C.amber }}>지금 하실 일 · 8월 20일까지</div>
          <div style={{ fontSize: 18, fontWeight: 650, color: C.ink1, marginTop: 3 }}>피해구제 신청서를 국민은행 앱에서 제출하세요</div>
        </div>
        <span style={{ display: 'inline-flex', minHeight: 44, alignItems: 'center', borderRadius: 10, background: '#fff', padding: '0 20px', fontSize: 13.5, fontWeight: 660, color: '#000' }}>지금 하기</span>
      </div>
      <div style={{ marginTop: 16 }}>
        {rows.map(([m, label, tag, col], i) => (
          <div key={label} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px',
            borderBottom: i < rows.length - 1 ? `1px solid ${C.hair}` : 'none', ...MOTION.enter(T, at + 0.15 + i * 0.12),
          }}>
            <span style={{
              width: 21, height: 21, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 999, fontSize: 11, fontWeight: 700,
              background: col === C.pii ? 'oklch(0.697 0.16 258.2 / 22%)' : col === C.amber ? 'oklch(0.77 0.117 70.9 / 20%)' : 'transparent',
              border: `1px solid ${col === C.ink3 ? 'oklch(0.305 0.013 267.1 / 70%)' : col}`, color: col,
            }}>{m}</span>
            <span style={{ flex: 1, fontSize: 14.5, color: C.ink2, fontWeight: m === '→' ? 620 : 460 }}>{label}</span>
            <span style={{ fontSize: 12.5, color: col, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flex: 'none' }}>{tag}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, marginTop: 20, maxWidth: 560, ...MOTION.enter(T, at + 0.7) }}>
        {[['지급정지', C.pii], ['피해구제', C.amber], ['공고 2개월', null], ['결정', null], ['환급', null]].map(([s, col]) => (
          <div key={s}>
            <div style={{ height: 4, borderRadius: 999, background: col || 'oklch(1 0 0 / 12%)' }} />
            <div style={{ fontSize: 11.5, color: col || C.icon, marginTop: 5 }}>{s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Piece({ tweaks }) {
  const { T, CUES, time } = useComposition();
  const B = CUES['보드 전환'], P = CUES['패널 등장'], Rt = CUES['챗 복귀'];

  const pIn = MOTION.move(T, P + 0.15, P + 1.05);          // 패널 스르륵 in
  const pOut = MOTION.move(T, Rt + 1.5, Rt + 2.3);          // 패널 out (복귀 끝자락)
  const panelVis = clamp(pIn - pOut, 0, 1);
  const m = clamp(MOTION.move(T, B + 0.2, B + 1.5) - MOTION.move(T, Rt + 0.5, Rt + 1.8), 0, 1); // 게이트용 총량
  // 축다로 빨려드는 경로: x가 먼저 범위로 붙고 → y가 늦게 다이브 → 스케일이 따라붙음 (역방향은 위로 먼저 떠오른 뒤 펼쳐짐)
  const mx = clamp(MOTION.move(T, B + 0.2, B + 1.35) - MOTION.move(T, Rt + 0.65, Rt + 1.8), 0, 1);
  const my = clamp(MOTION.move(T, B + 0.45, B + 1.55) - MOTION.move(T, Rt + 0.5, Rt + 1.55), 0, 1);
  const ms = clamp(MOTION.move(T, B + 0.35, B + 1.5) - MOTION.move(T, Rt + 0.55, Rt + 1.7), 0, 1);
  const bVis = clamp(MOTION.move(T, B + 0.6, B + 1.6) - MOTION.move(T, Rt + 0.6, Rt + 1.5), 0, 1);   // 보드 등장·퇴장(챗 확장과 겹치게)

  const HEADER = 46, PW = 300;
  const chatW = 1280 - PW * panelVis;                        // 패널만큼 좁아짐
  const scale = lerp(1, PW / 980, ms);
  const chatX = lerp(0, 1280 - PW, mx);
  const chatY = lerp(HEADER, HEADER + 342, my);
  const panelH = lerp(720 - HEADER, 340, my);
  const fullFade = 1 - clamp((ms - 0.55) / 0.35, 0, 1);       // 축소 중 원본 챗 페이드아웃
  const miniFade = clamp((ms - 0.68) / 0.32, 0, 1);           // 제자리에서 미니 챗이 이어받음
  // 블랙홀 변형 — 빨려드는 중간에만 최대(양 끝점은 정형): 가로 핀치 + 세로 늘어짐 + 진행방향 기울기
  const d = Math.sin(clamp(ms, 0, 1) * Math.PI);
  const sx = scale * (1 - 0.16 * d);
  const sy = scale * (1 + 0.09 * d);

  return (
    <div data-screen-label={`t=${Math.floor(time)}s`} style={{ position: 'absolute', inset: 0, background: C.ground, overflow: 'hidden', fontFamily: F }}>
      {/* 헤더 */}
      <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: HEADER, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px', borderBottom: `1px solid ${C.hair}`, background: C.stage, zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16.5, fontWeight: 660, letterSpacing: '-0.02em', color: C.ink1 }}>Fin<span style={{ color: C.pii }}>Ally</span></span>
          <Chip>사건 7fK2p</Chip>
        </div>
        <div style={{ opacity: bVis }}><Chip amber>피해구제 신청까지 D-2</Chip></div>
      </div>

      {/* 보드 — 챗이 비켜나면 주인 */}
      <div style={{ position: 'absolute', left: 0, top: HEADER, width: chatW, height: 720 - HEADER, opacity: bVis, transform: `translateY(${(1 - bVis) * 22}px)` }}>
        <BoardContent T={T} at={B + 0.7} />
      </div>

      {/* 우측 패널 — 오른쪽에서 스르륵 */}
      <div style={{ position: 'absolute', top: HEADER, width: PW, height: panelH, left: 1280 - PW * panelVis + (1 - panelVis) * 8, borderLeft: `1px solid ${C.hair}`, background: 'oklch(1 0 0 / 1.5%)', opacity: clamp(panelVis * 1.4, 0, 1) }}>
        <PanelContent T={T} at={P + 0.5} />
      </div>

      {/* 챗 — full ↔ 우하단 슬롯으로 빨려들기 */}
      <div style={{
        position: 'absolute', left: chatX, top: chatY, width: ms > 0.01 ? 980 : chatW, height: 676,
        transform: `perspective(1400px) rotateX(${(7 * d).toFixed(2)}deg) rotateY(${(-15 * d).toFixed(2)}deg) scale(${sx}, ${sy}) skewY(${(3.2 * d).toFixed(2)}deg) rotate(${(-2.2 * d).toFixed(2)}deg)`, transformOrigin: 'top left',
        borderRadius: lerp(0, 14 / scale, ms) + 26 * d, border: ms > 0.05 ? `1px solid ${C.hair}` : 'none',
        background: ms > 0.05 ? 'oklch(0.12 0.004 285.9)' : 'transparent',
        boxShadow: ms > 0.05 ? '0 30px 60px -30px #000' : 'none', overflow: 'hidden', zIndex: 3, opacity: fullFade,
      }}>
        <ChatContent T={T} />
      </div>

      {/* 미니 챗 — 축소 형태의 실제 모습 (S-07 우측 열 문법), 축소 말미에 교차로 이어받음 */}
      <div style={{ position: 'absolute', left: 1280 - PW, top: HEADER + 342, width: PW, height: 720 - HEADER - 342, opacity: miniFade, zIndex: 4, borderLeft: `1px solid ${C.hair}`, background: 'oklch(1 0 0 / 1.5%)', padding: '14px 18px 16px', display: miniFade < 0.01 ? 'none' : 'flex', flexDirection: 'column', fontFamily: F }}>
        <div style={{ fontSize: 11.5, letterSpacing: '.12em', color: C.icon, marginBottom: 9 }}>대응 비서</div>
        <div style={{ display: 'grid', gap: 8, alignContent: 'start', flex: 1 }}>
          <div style={{ padding: '10px 12px', borderRadius: '13px 13px 13px 4px', border: `1px solid ${C.hair}`, background: C.surface, fontSize: 13, lineHeight: 1.55, color: C.ink2 }}>다음은 <b style={{ fontWeight: 640, color: C.ink1 }}>피해구제 신청</b>입니다 — <b style={{ fontWeight: 640, color: C.amber }}>8월 20일</b>까지요.</div>
          <div style={{ marginLeft: 'auto', padding: '10px 12px', borderRadius: '13px 13px 4px 13px', background: 'oklch(1 0 0 / 11%)', fontSize: 13, color: C.ink1 }}>뭐부터 하면 돼요?</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 42, borderRadius: 12, border: '1px solid oklch(0.697 0.16 258.2 / 45%)', background: C.surface, boxShadow: '0 0 0 3px oklch(0.697 0.16 258.2 / 10%)', padding: '0 12px' }}>
          <span style={{ fontSize: 12.5, color: 'oklch(0.65 0 89.9)' }}>무엇이든 물어보세요</span>
          <span style={{ width: 26, height: 26, flex: 'none', borderRadius: 999, background: '#fff', color: '#000', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>↑</span>
        </div>
      </div>

      {tweaks.showCaptions && <Captions style={{ top: 58, bottom: 'auto', zIndex: 20, font: `560 21px ${F}`, color: '#f6f4ef' }} items={[
        { at: 0.3, text: 'S-06 챗 국면 — 진술이 사건을 엽니다' },
        { at: P + 0.2, text: '단계를 가리키면, 패널이 오른쪽에서 스르륵' },
        { at: B + 0.3, text: '답이 모이면 챗은 비서 자리로 — 보드가 주인' },
        { at: B + 2.6, text: '며칠 뒤 열어도 첫 줄이 답입니다' },
        { at: Rt + 0.4, until: Rt + 2.8, text: '다시 물으면 — 챗이 슈루룩 앞으로' },
      ]} />}
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0c0c0e' }}>
      <CompositionStage width={1280} height={720} bg="#000" scenes={window.OM_SCENES} playback={window.OM_PLAYBACK}>
        <Piece tweaks={t} />
      </CompositionStage>
      <TweaksPanel>
        <TweakSection label="모션" />
        <TweakToggle label="Motion editor" value={t.motionEditor} onChange={(v) => setTweak('motionEditor', v)} />
        <TweakToggle label="캡션" value={t.showCaptions} onChange={(v) => setTweak('showCaptions', v)} />
      </TweaksPanel>
    </div>
  );
}
window.PhasePiece = App;
