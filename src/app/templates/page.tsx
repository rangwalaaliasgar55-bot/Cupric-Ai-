import TemplatePlayground from "@/components/TemplatePlayground";
import AssetGallery from "@/components/AssetGallery";

export default function TemplatesPage() {
  return (
    <>
      <TemplatePlayground />
      <AssetGallery categories={["templates"]} title="All templates" intro="Complete, editable compositions across SaaS, AI, startup, app, corporate, YouTube, Shorts, Reels, TikTok, explainer, education, finance, technology, cyber, luxury, minimal, editorial, gaming, data and cinematic categories." />
    </>
  );
}
