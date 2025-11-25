import { type AuthClient, GoogleAuth, Impersonated } from "google-auth-library";

export async function createImpersonatedAuthClient(
  serviceAccountEmail: string,
  scopes: string[],
): Promise<AuthClient> {
  if (!serviceAccountEmail) {
    throw new Error("SERVICE_ACCOUNT_EMAIL is required for impersonation");
  }

  const baseAuth = new GoogleAuth({ scopes });
  const sourceClient = await baseAuth.getClient();

  return new Impersonated({
    sourceClient,
    targetPrincipal: serviceAccountEmail,
    delegates: [],
    lifetime: 3600,
    targetScopes: scopes,
  });
}
