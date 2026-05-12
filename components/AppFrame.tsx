import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE_NAME, isValidAccessCode } from "@/lib/shared-access";
import ClearDeprecatedLocalItems from "@/components/ClearDeprecatedLocalItems";
import SignOutButton from "@/components/SignOutButton";
import BottomNav from "@/components/BottomNav";

export default async function AppFrame({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const accessCode = cookieStore.get(ACCESS_COOKIE_NAME)?.value;

  if (!isValidAccessCode(accessCode)) redirect("/login");

  return (
    <>
      <ClearDeprecatedLocalItems />
      <header className="top-header">
        <Link href="/" className="brand" aria-label="Hán Ngữ">
          <span className="brand-mark">汉</span>
          <span>Hán Ngữ</span>
        </Link>
        <SignOutButton />
      </header>
      <main className="app-shell">{children}</main>
      <BottomNav />
    </>
  );
}
