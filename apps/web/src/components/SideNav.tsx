"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
}

const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dex", label: "DEX Screener" },
  { href: "/markets", label: "Markets" },
  { href: "/wallets", label: "Wallets" },
  { href: "/exchange", label: "Exchange" },
  { href: "/positions", label: "Open Positions" },
  { href: "/history", label: "Trade History" },
  { href: "/portfolio", label: "Portfolio & P&L" },
  { href: "/alerts", label: "Alerts" },
  { href: "/strategies", label: "Strategies" },
  { href: "/settings", label: "Settings" },
];

const ADMIN: NavItem[] = [
  { href: "/admin/users", label: "User Management" },
  { href: "/admin/audit", label: "Audit Log" },
];

export function SideNav({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();

  const renderItem = (item: NavItem) => {
    const active = pathname === item.href || pathname.startsWith(item.href + "/");
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`nav-link${active ? " active" : ""}`}
      >
        <span className="dot" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav>
      <div className="nav-section">Trading</div>
      {PRIMARY.map(renderItem)}
      {showAdmin ? (
        <>
          <div className="nav-section">Administration</div>
          {ADMIN.map(renderItem)}
        </>
      ) : null}
    </nav>
  );
}
