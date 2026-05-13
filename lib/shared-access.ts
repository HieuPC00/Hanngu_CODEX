export const ACCESS_COOKIE_NAME = "hanngu_access_code";
export const SHARED_ACCOUNTS = [
  {
    code: process.env.NEXT_PUBLIC_HANNGU_ACCESS_CODE || "999999",
    ownerId: process.env.NEXT_PUBLIC_HANNGU_SHARED_OWNER_ID || "88d2c940-8702-41c9-8669-7b176f01c216"
  },
  {
    code: process.env.NEXT_PUBLIC_HANNGU_ACCESS_CODE_2 || "888888",
    ownerId: process.env.NEXT_PUBLIC_HANNGU_SHARED_OWNER_ID_2 || "b5e519d5-c39c-4f27-849d-d0d46db9d134"
  }
] as const;

export const SHARED_OWNER_IDS = SHARED_ACCOUNTS.map((account) => account.ownerId);

export function isValidAccessCode(code: string | null | undefined) {
  return Boolean(getOwnerIdForAccessCode(code));
}

export function getOwnerIdForAccessCode(code: string | null | undefined) {
  return SHARED_ACCOUNTS.find((account) => account.code === code)?.ownerId || null;
}

export function getBrowserOwnerId() {
  if (typeof document === "undefined") return SHARED_ACCOUNTS[0].ownerId;
  return getOwnerIdForAccessCode(readCookieValue(document.cookie, ACCESS_COOKIE_NAME)) || SHARED_ACCOUNTS[0].ownerId;
}

export function readCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;

  const parts = cookieHeader.split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  if (!match) return null;

  return decodeURIComponent(match.slice(name.length + 1));
}
