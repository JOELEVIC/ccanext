import { config } from "@/config/env";

/**
 * Verify a Google ID token (from Google Identity Services on the client) using
 * Google's tokeninfo endpoint, which validates the signature + expiry
 * server-side. We additionally confirm the token was minted BY Google and FOR
 * one of OUR OAuth clients.
 *
 * The client IDs are public by design — they ship in the browser bundle and in
 * the Android/iOS binaries — so listing them in code or in an env var gives an
 * attacker nothing. The client *secret* is never used in this ID-token flow.
 */

/**
 * The web OAuth client, kept as a constant rather than moved wholly into the
 * environment for one reason: it is already deployed and nothing sets the env
 * var yet. `ccaui` ships this id, the Flutter app passes it as `serverClientId`
 * on both platforms (which is what puts it in the token's `aud`), and Vercel
 * has no GOOGLE_CLIENT_IDS variable configured. If the env var were the only
 * source, the next deploy would reject every Google sign-in in the field until
 * somebody remembered to set it — and that failure is close to unattributable
 * from the outside, because the token is well-formed, the account chooser looks
 * normal, and the only symptom is a generic "Google sign-in failed".
 *
 * So this stays the FALLBACK, and an unset env var behaves exactly as the code
 * did before the allow-list existed.
 */
export const GOOGLE_CLIENT_ID =
  "649457496601-402n1u69bjcev77ntndni2ms4o22b03k.apps.googleusercontent.com";

/**
 * The only two values Google puts in `iss`. Both spellings are live — the
 * bare host is the historical form and still appears — so both are accepted
 * and nothing else is.
 *
 * This check is free and it was missing. tokeninfo will not verify a token
 * signed by anybody but Google, so on its own the omission was not exploitable
 * today; the check exists so that the day this file stops calling tokeninfo and
 * starts verifying JWKS locally — the obvious next step, since tokeninfo is a
 * blocking network hop on every sign-in — the issuer is already being asserted
 * rather than being a thing somebody has to remember to add.
 */
const GOOGLE_ISSUERS: ReadonlySet<string> = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

/**
 * Build the audience allow-list from a comma-separated string.
 *
 * ONE RULE MAKES THIS DANGEROUS AND IT IS NOT OBVIOUS: every id in the list
 * must belong to the SAME Google Cloud project. `aud` says which OAuth client
 * asked for the token, not which app the person thought they were signing in
 * to. Add an id from an unrelated project and this API will accept an ID token
 * minted for that unrelated app — so anyone who can get a user through that
 * app's consent screen holds a token this server treats as proof of identity,
 * and `loginWithGoogle` will find-or-create a CCA account from it.
 *
 * The list exists because Android and iOS do not agree on what `aud` is.
 * Android's `GetSignInWithGoogleOption` puts the `serverClientId` we hand it —
 * the web client — into `aud`, so Android matches the fallback with no server
 * change at all. iOS mints against the *iOS* client id, so iOS is dead on
 * arrival until that id is in this list.
 *
 * Matching is EXACT. Never `startsWith`, never `endsWith`, never `includes`:
 * every Google client id ends in `.apps.googleusercontent.com` and begins with
 * a project number that is public, so a suffix test accepts every Google client
 * on earth and a prefix test accepts every client in our own project including
 * ones created later for something else entirely.
 *
 * Empty and whitespace-only entries are dropped rather than kept as `""`. A
 * `""` in the set would match a token carrying `aud: ""`, which is exactly the
 * shape a malformed or hand-rolled token has, and a single stray comma in an
 * env var is all it would take to put it there.
 */
export function parseAudienceAllowList(raw: string | null | undefined): ReadonlySet<string> {
  const ids = (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  // An unset, empty or all-whitespace variable is not an instruction to accept
  // everything and not an instruction to accept nothing — it means "nobody has
  // configured this deployment", and the behaviour that keeps the shipped
  // clients working is the single hardcoded web client.
  return ids.length > 0 ? new Set(ids) : new Set([GOOGLE_CLIENT_ID]);
}

/**
 * Computed once at module load, deliberately. The allow-list is deployment
 * configuration, not per-request state: re-reading it per call would let a
 * process pick up a half-written value and would hide a typo behind whichever
 * request happened to arrive first.
 */
export const GOOGLE_AUDIENCE_ALLOW_LIST = parseAudienceAllowList(config.google.clientIds);

export interface GoogleProfile {
  email: string;
  name?: string;
}

/**
 * `allowedAudiences` is a parameter rather than a straight module reference so
 * the audience rule — the single most security-load-bearing line in this repo —
 * can be tested against a list the test controls, instead of against whatever
 * the machine running the suite happens to have in its `.env`. Production never
 * passes it.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  allowedAudiences: ReadonlySet<string> = GOOGLE_AUDIENCE_ALLOW_LIST,
): Promise<GoogleProfile | null> {
  if (!idToken || typeof idToken !== "string") return null;
  let data: Record<string, unknown>;
  try {
    const res = await fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
    );
    if (!res.ok) return null;
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
  // tokeninfo already checked signature + expiry; we check issuer, audience and
  // the verified-email flag.
  if (data.error) return null;
  if (typeof data.iss !== "string" || !GOOGLE_ISSUERS.has(data.iss)) return null;
  // `typeof` first: `Set.has` on a non-string is a silent false today, but the
  // explicit test is what stops a future refactor comparing an array `aud`
  // (which some OIDC providers emit) by anything but exact string identity.
  if (typeof data.aud !== "string" || !allowedAudiences.has(data.aud)) return null;
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  if (!email) return null;
  const verified = data.email_verified === "true" || data.email_verified === true;
  if (!verified) return null;
  return { email, name: typeof data.name === "string" ? data.name : undefined };
}
