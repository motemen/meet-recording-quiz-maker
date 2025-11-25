import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

/**
 * Access a Secret Manager version and return the decoded payload (utf8 string).
 * Expects a full resource name like:
 *   projects/{project}/secrets/{secret}/versions/{version}
 * Uses the official @google-cloud/secret-manager client with Application Default Credentials.
 */
export async function accessSecretPayload(name: string): Promise<string> {
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({ name });
  const data = version.payload?.data?.toString();
  if (!data) {
    throw new Error(`Secret payload not found for ${name}`);
  }
  return data;
}

/** Build a secret version resource name. version defaults to "latest". */
export function buildSecretVersionName(
  projectId: string,
  secretId: string,
  version: string = "latest",
): string {
  return `projects/${projectId}/secrets/${secretId}/versions/${version}`;
}
