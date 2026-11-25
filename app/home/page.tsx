import type { Metadata } from "next";
import HomeScreen from "@/components/HomeScreen";

export const metadata: Metadata = {
  title: "Home — Mutable",
};

export default function HomePage() {
  return <HomeScreen />;
}
