"use client";

import { createContext, useContext } from "react";

// Whether the signed-in account is on ADMIN_EMAILS. Decided once on the server in the (app) layout and passed down,
// so client pages never ask the network (a Clerk round-trip per page load hung the Settings page in QA).
export const AdminContext = createContext(false);
export const useAdmin = () => useContext(AdminContext);
