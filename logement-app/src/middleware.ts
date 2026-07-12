export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/residences/:path*",
    "/occupants/:path*",
    "/reservations/:path*",
    "/finances/:path*",
    "/utilisateurs/:path*",
  ],
};
