import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Theme } from "@astryxdesign/core/theme";
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import type React from "react";
import { themes, defaultThemeSlug } from "../../astryx-themes";

import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Super Mongoose Studio" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Theme theme={themes[defaultThemeSlug]} mode="system">
          <AppShellWrapper />
        </Theme>
        <Scripts />
      </body>
    </html>
  );
}

function AppShellWrapper() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const navigate = useNavigate();

  const go = (to: string) => (event: { preventDefault?(): void; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }) => {
    const modifier = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

    if (modifier) {
      return;
    }

    event.preventDefault?.();
    void navigate({ to });
  };

  const item = (label: string, to: string) => (
    <SideNavItem
      label={label}
      href={to}
      isSelected={pathname === to}
      onClick={go(to)}
    />
  );

  return (
    <AppShell
      contentPadding={4}
      variant="wash"
      height="fill"
      sideNav={
        <SideNav header={<SideNavHeading heading="Super Mongoose Studio" headingHref="/" />}>
          <SideNavSection title="Navigation" isHeaderHidden>
            {item("Dashboard", "/")}
            {item("Collections", "/collections")}
            {item("Query lab", "/query")}
            {item("Migrations", "/migrations")}
          </SideNavSection>
        </SideNav>
      }
    >
      <Outlet />
    </AppShell>
  );
}
