export type GstOtpMessage = { draftId: string; period: string; code: string };

export interface GstOtpDelivery {
  send(message: GstOtpMessage): Promise<void>;
}

export const developmentConsoleOtpDelivery: GstOtpDelivery = {
  async send({ draftId, period, code }) {
    if (process.env.NODE_ENV === "production" || process.env.GST_ENV !== "sandbox") {
      throw new Error("Development-console OTP delivery is disabled outside GST_ENV=sandbox development.");
    }
    console.info(`[DEV OTP — remove before production] draftId=${draftId} period=${period} code=${code}`);
  },
};
