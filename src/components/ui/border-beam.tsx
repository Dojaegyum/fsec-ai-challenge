"use client";

// border-beam 패키지는 "use client" 없이 훅(useState·useEffect·useId)을 쓴다.
// App Router 기본은 서버 컴포넌트이므로 이 래퍼에서 경계를 세운다.

import { BorderBeam } from "border-beam";
import type {
  BorderBeamProps,
  BorderBeamSize,
  BorderBeamTheme,
  BorderBeamColorVariant,
} from "border-beam";

export type {
  BorderBeamProps,
  BorderBeamSize,
  BorderBeamTheme,
  BorderBeamColorVariant,
};

export { BorderBeam };
export default BorderBeam;
