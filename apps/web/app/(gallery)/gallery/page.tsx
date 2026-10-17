"use client";

import { PageHeader } from "@/app/(chat)/components/page-header";

import { MediaGallery } from "./components/media-gallery";

// /gallery: every image and PDF the caller has stored, newest first.
export default function GalleryPage() {
  return (
    <>
      <PageHeader title="Gallery" />
      <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
        <MediaGallery />
      </div>
    </>
  );
}
