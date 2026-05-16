import "vscode";

declare module "vscode" {
  interface QuickInput {
    /** Hides the filter box so the quick pick behaves as a simple menu (Skippr IDE). */
    hideInput?: boolean;
  }
}
