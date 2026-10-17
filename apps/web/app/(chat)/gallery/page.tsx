"use client";

import { MediaGallery } from "../components/media-gallery";
import { PageHeader } from "../components/page-header";

// /gallery: every image and PDF the caller has stored, newest first. The
// chat layout's main rail stays; its chat and project second rails and the
// chat header yield on this route, so the grid takes the whole inset.
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
