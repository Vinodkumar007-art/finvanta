import { createReadStream } from "node:fs";
import { createConnection } from "node:net";
import { once } from "node:events";

export class AntivirusUnavailableError extends Error {}
export class MalwareDetectedError extends Error {}

export function isAntivirusConfigured(): boolean {
  return Boolean(process.env.CLAMAV_HOST?.trim());
}

export async function scanUploadWithClamAv(filePath: string): Promise<void> {
  const host = process.env.CLAMAV_HOST?.trim();
  if (!host) throw new AntivirusUnavailableError("Antivirus scanning is not configured.");
  const port = Number(process.env.CLAMAV_PORT ?? "3310");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AntivirusUnavailableError("Antivirus scanner configuration is invalid.");

  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = "";
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(60_000, () => settle(new AntivirusUnavailableError("Antivirus scanning timed out.")));
    socket.on("error", (error) => settle(new AntivirusUnavailableError(`Antivirus scanner connection failed: ${error.message}`)));
    socket.on("close", () => {
      if (!settled) settle(new AntivirusUnavailableError("Antivirus scanner closed without a response."));
    });
    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString("utf8").replace(/\0/g, "");
      if (response.includes("FOUND")) settle(new MalwareDetectedError("The file was rejected by the antivirus scanner."));
      else if (response.includes("OK")) settle();
      else if (response.length > 4096) settle(new AntivirusUnavailableError("Antivirus scanner returned an invalid response."));
    });
    socket.once("connect", () => {
      void (async () => {
        try {
          socket.write(Buffer.from("zINSTREAM\0", "ascii"));
          for await (const chunk of createReadStream(filePath)) {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const length = Buffer.allocUnsafe(4);
            length.writeUInt32BE(data.length);
            if (!socket.write(Buffer.concat([length, data]))) await once(socket, "drain");
          }
          socket.end(Buffer.alloc(4));
        } catch (error) {
          settle(error instanceof Error ? error : new AntivirusUnavailableError("Antivirus scanning failed."));
        }
      })();
    });
  });
}
