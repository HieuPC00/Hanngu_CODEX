"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Học" },
  { href: "/upload", label: "Upload" },
  { href: "/library", label: "Thư viện" }
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="Điều hướng chính">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={`nav-link ${pathname === link.href ? "active" : ""}`}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
