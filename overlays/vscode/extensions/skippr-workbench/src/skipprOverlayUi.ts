import * as vscode from "vscode";

export interface SkipprEmailOtpDeps {
  apiRequest(path: string, method: string, body?: unknown, token?: string): Promise<Response>;
}

/**
 * Email + OTP sign-in using Quick Input (overlay-style, no editor-tab webview).
 * Does not persist secrets; caller should `saveAuthSession` and notify the auth provider.
 */
export async function runEmailOtpAuthQuickInput(deps: SkipprEmailOtpDeps): Promise<{ token: string; refreshToken: string; email: string } | undefined> {
  for (;;) {
    const emailRaw = await vscode.window.showInputBox({
      title: "Sign in to Skippr",
      prompt: "We will email you a short verification code.",
      placeHolder: "Email address",
      ignoreFocusOut: true
    });
    if (emailRaw === undefined) {
      return undefined;
    }
    const email = emailRaw.trim();
    if (!email) {
      void vscode.window.showErrorMessage("Enter your email address.");
      continue;
    }

    const started = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Skippr sign-in", cancellable: false },
      async () => (await deps.apiRequest("/auth/sign-in", "POST", { email })).ok
    );
    if (!started) {
      void vscode.window.showErrorMessage("We couldn't start sign-in. Check the email and try again.");
      continue;
    }

    for (;;) {
      const codeRaw = await vscode.window.showInputBox({
        title: "Sign in to Skippr",
        prompt: `Enter the verification code sent to ${email}.`,
        placeHolder: "6-digit code",
        ignoreFocusOut: true
      });
      if (codeRaw === undefined) {
        return undefined;
      }
      const code = codeRaw.trim();
      if (!code) {
        void vscode.window.showErrorMessage("Enter the verification code.");
        continue;
      }

      const confirmResponse = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Verifying…", cancellable: false },
        async () => deps.apiRequest("/auth/confirm", "POST", { email, code })
      );
      if (!confirmResponse.ok) {
        void vscode.window.showErrorMessage("That code is invalid or expired.");
        continue;
      }
      const tokenPayload = (await confirmResponse.json()) as { token: string; refresh_token: string };
      return { token: tokenPayload.token, refreshToken: tokenPayload.refresh_token, email };
    }
  }
}
