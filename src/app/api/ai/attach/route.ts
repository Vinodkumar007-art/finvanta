import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST() {
  return json({ error: "File attachments are disabled until secure storage and antivirus scanning are configured and integrated." }, 503);
}
