import { notFound } from "next/navigation";

// With two root layouts (the site and /offline) Next gives unknown addresses a bare 404; this keeps the site's own.
export default function Missing() {
  notFound();
}
