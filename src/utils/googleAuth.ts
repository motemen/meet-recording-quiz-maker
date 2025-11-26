import { GoogleAuth, Impersonated, type OAuth2Client } from "google-auth-library";
import { logger } from "../logger.js";

export async function createImpersonatedAuthClient(
  serviceAccountEmail: string,
  scopes: string[],
): Promise<OAuth2Client> {
  if (!serviceAccountEmail) {
    throw new Error("SERVICE_ACCOUNT_EMAIL is required for impersonation");
  }

  const baseAuth = new GoogleAuth();
  const { client_email: clientEmail } = await baseAuth.getCredentials();
  logger.debug("google_impersonation_init", {
    targetPrincipal: serviceAccountEmail,
    sourceClientEmail: clientEmail,
    scopes,
  });
  const sourceClient = await baseAuth.getClient();

  return new Impersonated({
    sourceClient,
    targetPrincipal: serviceAccountEmail,
    delegates: [],
    lifetime: 3600,
    targetScopes: scopes,
  });
}
