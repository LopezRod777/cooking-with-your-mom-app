import { OfflineShell } from "@/components/offline/OfflineShell";

// Public and the same for everyone: the service worker (public/sw.js) keeps this page for when there is no signal.
export default function OfflinePage() {
  return <OfflineShell />;
}
