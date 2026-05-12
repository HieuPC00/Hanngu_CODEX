export const ACCESS_COOKIE_NAME = "hanngu_access_code";
export const SHARED_ACCESS_CODE = process.env.NEXT_PUBLIC_HANNGU_ACCESS_CODE || "999999";
export const SHARED_OWNER_ID = process.env.NEXT_PUBLIC_HANNGU_SHARED_OWNER_ID || "88d2c940-8702-41c9-8669-7b176f01c216";

export function isValidAccessCode(code: string | null | undefined) {
  return code === SHARED_ACCESS_CODE;
}

export function readCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;

  const parts = cookieHeader.split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  if (!match) return null;

  return decodeURIComponent(match.slice(name.length + 1));
}
