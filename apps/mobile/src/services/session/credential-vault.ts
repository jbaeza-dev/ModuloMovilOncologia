/** All implementations used by the app must encrypt values with the native keystore. */
export interface CredentialVault {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
