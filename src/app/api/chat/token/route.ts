import { SignJWT } from "jose";
import { apiCtx, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await apiCtx(request, { mutate: true });
  if ("error" in auth) return auth.error;
  const secret = process.env.CHAT_JWT_SECRET;
  if (!secret || secret.length < 32) return json({ error: "Chat authentication is not configured." }, 503);

  const token = await new SignJWT({ orgId: auth.ctx.org.id, name: auth.ctx.user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("finvanta")
    .setAudience("finvanta-chat")
    .setSubject(auth.ctx.user.id)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(secret));

  return json({ token, expiresIn: 900 });
}
