import { PageHeader } from "../components/page-header";
import { KnowledgeSpaces } from "./knowledge-spaces";

/** Brain: the owner's Knowledge Spaces. Content inside a Space is later work. */
export default function BrainPage() {
  return (
    <>
      <PageHeader title="Brain" />
      <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
        <KnowledgeSpaces />
      </div>
    </>
  );
}
