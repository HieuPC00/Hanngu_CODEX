import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import ClearDeprecatedLocalItems from "@/components/ClearDeprecatedLocalItems";
import SignOutButton from "@/components/SignOutButton";
import BottomNav from "@/components/BottomNav";

export default async function AppFrame({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

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
