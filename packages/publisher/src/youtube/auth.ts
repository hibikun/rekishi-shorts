import { google } from "googleapis";
import { config } from "../config.js";

export function createAuthClient(): InstanceType<typeof google.auth.OAuth2> {
  const oauth2 = new google.auth.OAuth2(
    config.youtube.clientId,
    config.youtube.clientSecret,
    config.youtube.redirectUri,
  );
  oauth2.setCredentials({ refresh_token: config.youtube.refreshToken });
  return oauth2;
}
