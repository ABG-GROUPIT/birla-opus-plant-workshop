import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

function normalizeBasePath(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed || trimmed === "/") {
    return "/birla-opus-plant-workshop";
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

const pagesBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BASE_PATH: isGitHubPages
      ? pagesBasePath
      : (process.env.NEXT_PUBLIC_BASE_PATH ?? ""),
  },
  ...(isGitHubPages
    ? {
        output: "export" as const,
        basePath: pagesBasePath,
        trailingSlash: true,
        images: {
          unoptimized: true,
        },
      }
    : {}),
};

export default nextConfig;
