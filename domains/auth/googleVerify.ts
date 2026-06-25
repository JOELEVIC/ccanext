/**
 * Verify a Google ID token (from Google Identity Services on the client) using
 * Google's tokeninfo endpoint, which validates the signature + expiry server-side.
 * We additionally confirm the token was issued for OUR OAuth client.
 *
 * The client ID is public by design (it ships in the browser), so hardcoding it
 * is fine. The client *secret* is never used in this ID-token flow.
 */
export const GOOGLE_CLIENT_ID =
  "649457496601-402n1u69bjcev77ntndni2ms4o22b03k.apps.googleusercontent.com";

export interface GoogleProfile {
  email: string;
  name?: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile | null> {
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
  // tokeninfo already checked signature + expiry; we check audience + verified email.
  if (data.error || data.aud !== GOOGLE_CLIENT_ID) return null;
  const email = typeof data.email === "string" ? data.email.toLowerCase() : "";
  if (!email) return null;
  const verified = data.email_verified === "true" || data.email_verified === true;
  if (!verified) return null;
  return { email, name: typeof data.name === "string" ? data.name : undefined };
}
