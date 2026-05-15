import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/** Matches skippr-cli `StoredCredentials` (serde snake_case). */
export interface SkipprCliStoredCredentials {
  access_token: string;
  refresh_token: string;
}

function credentialsPaths(): { dir: string; file: string } {
  const dir = path.join(os.homedir(), ".skippr");
  return { dir, file: path.join(dir, "credentials.json") };
}

export async function writeSkipprCliCredentialsFile(session: SkipprCliStoredCredentials): Promise<{ ok: true } | { ok: false; message: string }> {
  const { dir, file } = credentialsPaths();
  const tmp = path.join(dir, `.credentials.${process.pid}.${Date.now()}.tmp.json`);
  const body = JSON.stringify(
    { access_token: session.access_token, refresh_token: session.refresh_token },
    null,
    2
  );
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmp, body, "utf8");
    try {
      await fs.unlink(file);
    } catch {
      // ignore missing destination
    }
    await fs.rename(tmp, file);
    return { ok: true };
  } catch (e) {
    try {
      await fs.unlink(tmp);
    } catch {
      // ignore
    }
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
  }
}

export async function clearSkipprCliCredentialsFile(): Promise<void> {
  const { file } = credentialsPaths();
  await fs.unlink(file).catch(() => {
    // ignore ENOENT
  });
}
