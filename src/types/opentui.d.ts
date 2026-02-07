/* OpenTUI type augmentation for ClawControl */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";

declare module "@opentui/react/jsx-namespace" {
  export namespace JSX {
    interface IntrinsicElements {
      box: any;
      text: any;
      span: any;
      input: any;
      select: any;
      option: any;
      scrollbox: any;
    }
  }
}
