import type { Metadata } from "next";
import "./backroom.css";

export const metadata: Metadata = { title: "Backroom · Antspace", robots: { index: false, follow: false } };
export default function BackroomLayout({ children }: { children: React.ReactNode }) { return children; }
