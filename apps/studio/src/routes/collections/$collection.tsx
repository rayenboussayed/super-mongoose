import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Stack } from "@astryxdesign/core/Stack";
import { Table, proportional } from "@astryxdesign/core/Table";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Switch } from "@astryxdesign/core/Switch";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import {
  getCollectionFn,
  listDocumentsFn,
  saveDocumentFn,
  deleteDocumentFn,
  createIndexFn,
  dropIndexFn,
  explainQueryFn,
} from "../../server/functions";
import type { DocumentPage, DocumentView } from "../../server/documents";
import type { IndexSummary } from "../../server/collections";

export const Route = createFileRoute("/collections/$collection")({
  loader: async ({ params }) => ({
    detail: await getCollectionFn({ data: params.collection }),
    documents: await listDocumentsFn({ data: { collection: params.collection, page: 1, pageSize: 25 } }),
  }),
  component: CollectionDetailPage,
});

const TABS = ["Documents", "Indexes", "Query plan", "Schema"] as const;

function CollectionDetailPage() {
  const { collection } = Route.useParams();
  const loader = Route.useLoaderData();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Documents");
  const [detail, setDetail] = useState(loader.detail);
  const [page, setPage] = useState(loader.documents);
  const [error, setError] = useState<string | null>(null);

  const refreshDetail = async () => {
    const next = await getCollectionFn({ data: collection })

    if (next.ok) {
      setDetail(next);
    }
  };

  const refreshDocuments = async (filter?: string, targetPage = 1) => {
    const next = await listDocumentsFn({
      data: {
        collection,
        filter,
        page: targetPage,
        pageSize: 25,
      },
    });

    if (next.ok) {
      setPage(next);
    } else {
      setError(next.error.message);
    }
  };

  if (!detail.ok) {
    return <Banner status="error" title="Could not load collection" description={detail.error.message} />;
  }

  const info = detail.data;
  const pageInfo = page.ok ? page.data : { documents: [], total: 0, page: 1, pageSize: 25, pages: 1, hasMore: false };
  const documentCount = pageInfo.total;

  return (
    <Stack gap={4}>
      <Stack direction="horizontal" gap={2} vAlign="center" wrap="wrap">
        <Heading level={1}>{collection}</Heading>
        <Text type="supporting" color="secondary">
          {documentCount} documents, {info.indexesDetail.length} indexes
        </Text>
      </Stack>
      {error ? <Banner status="error" title="Error" description={error} /> : null}
      <Stack direction="horizontal" gap={2} wrap="wrap">
        {TABS.map((item) => (
          <Button
            key={item}
            label={item}
            variant={tab === item ? "primary" : "secondary"}
            size="sm"
            onClick={() => setTab(item)}
          />
        ))}
      </Stack>
      {tab === "Documents" ? (
        <DocumentsTab
          collection={collection}
          page={pageInfo}
          onError={setError}
          onCreated={(view) => setPage((current) => (current.ok ? { ...current, data: { ...current.data, documents: [view, ...current.data.documents], total: current.data.total + 1 } } : current))}
          onDeleted={(id) => setPage((current) => (current.ok ? { ...current, data: { ...current.data, documents: current.data.documents.filter((item) => item.id !== id), total: Math.max(0, current.data.total - 1) } } : current))}
          onRefresh={refreshDocuments}
        />
      ) : null}
      {tab === "Indexes" ? (
        <IndexesTab
          collection={collection}
          indexes={info.indexesDetail}
          onError={setError}
          onRefresh={async () => {
            await refreshDetail();
          }}
        />
      ) : null}
      {tab === "Query plan" ? <QueryPlanTab collection={collection} onError={setError} /> : null}
      {tab === "Schema" ? (
        <Card>
          <Stack gap={3}>
            <Heading level={4}>Validator</Heading>
            <pre className="mono">{info.validator}</pre>
            <Heading level={4}>Options</Heading>
            <pre className="mono">{info.options}</pre>
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}

function DocumentsTab(props: {
  collection: string;
  page: DocumentPage;
  onError: (message: string) => void;
  onCreated: (view: DocumentView) => void;
  onDeleted: (id: string) => void;
  onRefresh: (search?: string, targetPage?: number) => Promise<void>;
}) {
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DocumentView | null>(null);
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<DocumentView | null>(null);

  const rows = props.page.documents.map((document) => ({
    id: document.id,
    preview: document.preview,
  }));

  const runSearch = async () => {
    await props.onRefresh(search, 1);
    setFilter(search);
  };

  const beginCreate = () => {
    setDraft("{\n  \n}\n");
    setCreating(true);
    setSaveError(null);
  };

  const beginEdit = (document: DocumentView) => {
    setDraft(document.json);
    setEditing(document);
    setSaveError(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);

    try {
      const response = await saveDocumentFn({
        data: {
          collection: props.collection,
          id: editing?.id,
          document: draft,
        },
      });

      if (!response.ok) {
        setSaveError(response.error.message);
        return;
      }

      if (editing) {
        await props.onRefresh(filter, props.page.page);
      } else {
        props.onCreated(response.data);
      }

      setCreating(false);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) {
      return;
    }

    const response = await deleteDocumentFn({
      data: { collection: props.collection, id: deleting.id },
    });

    if (!response.ok) {
      props.onError(response.error.message);
      return;
    }

    props.onDeleted(deleting.id);
    setDeleting(null);
  };

  const collectionColumns = [
    { key: "id", header: "_id", width: { type: "min", px: 200 } as never },
    { key: "preview", header: "Preview", width: proportional(1) },
  ];

  return (
    <Stack gap={3}>
      <Stack direction="horizontal" gap={2} wrap="wrap" vAlign="center">
        <TextInput
          label="Filter"
          value={search}
          onChange={setSearch}
          width={320}
          isLabelHidden
          placeholder='{ "status": "active" }'
        />
        <Button label="Search" variant="secondary" onClick={runSearch} />
        <Button label="New document" variant="primary" onClick={beginCreate} />
      </Stack>
      {props.page.documents.length === 0 ? (
        <EmptyState title="No documents" description="Add a document to get started." />
      ) : (
        <Card>
          <Table data={rows as never} columns={collectionColumns as never} idKey="id" hasHover />
        </Card>
      )}
      <Stack direction="horizontal" gap={2}>
        <Button
          label="Previous"
          variant="secondary"
          size="sm"
          isDisabled={props.page.page <= 1}
          onClick={() => props.onRefresh(filter, props.page.page - 1)}
        />
        <Text type="supporting">
          Page {props.page.page} of {props.page.pages}
        </Text>
        <Button
          label="Next"
          variant="secondary"
          size="sm"
          isDisabled={!props.page.hasMore}
          onClick={() => props.onRefresh(filter, props.page.page + 1)}
        />
      </Stack>
      {rows.map((row) => (
        <Stack key={row.id} direction="horizontal" gap={2}>
          <Button label={`Edit ${row.id.slice(0, 16)}`} variant="secondary" size="sm" onClick={() => {
            const found = props.page.documents.find((doc) => doc.id === row.id);

            if (found) {
              beginEdit(found);
            }
          }} />
          <Button
            label="Delete"
            variant="destructive"
            size="sm"
            onClick={() => {
              const found = props.page.documents.find((doc) => doc.id === row.id);

              if (found) {
                setDeleting(found);
              }
            }}
          />
        </Stack>
      ))}
      <Dialog isOpen={creating || editing !== null} onOpenChange={(next) => {
        if (!next) {
          setCreating(false);
          setEditing(null);
        }
      }}>
        <Layout
          header={<DialogHeader title={editing ? "Edit document" : "New document"} onOpenChange={(close) => {
            if (!close) {
              setCreating(false);
              setEditing(null);
            }
          }} />}
          content={
            <LayoutContent>
              <TextArea label="EJSON document" value={draft} onChange={setDraft} rows={16} />
              {saveError ? <Banner status="error" title="Could not save" description={saveError} /> : null}
              <Stack direction="horizontal" gap={2} hAlign="end" style={{ marginTop: 12 }}>
                <Button label="Cancel" variant="secondary" onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }} />
                <Button label={saving ? "Saving" : "Save"} variant="primary" onClick={save} isDisabled={saving} />
              </Stack>
            </LayoutContent>
          }
        />
      </Dialog>
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeleting(null);
          }
        }}
        title="Delete document?"
        description="This action cannot be undone."
        actionLabel="Delete"
        onAction={confirmDelete}
      />
    </Stack>
  );
}

function IndexesTab(props: {
  collection: string;
  indexes: IndexSummary[];
  onError: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [keys, setKeys] = useState('{ "field": 1 }');
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [open, setOpen] = useState(false);
  const [dropping, setDropping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const response = await createIndexFn({
      data: {
        collection: props.collection,
        keys,
        name: name.trim() ? name : undefined,
        unique,
        sparse,
      },
    });

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    setOpen(false);
    await props.onRefresh();
  };

  const drop = async () => {
    if (!dropping) {
      return;
    }

    const response = await dropIndexFn({
      data: { collection: props.collection, name: dropping },
    });

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    setDropping(null);
    await props.onRefresh();
  };

  const columns = [
    { key: "name", header: "Name", width: proportional(1) },
    { key: "keyText", header: "Keys", width: proportional(1) },
    { key: "unique", header: "Unique" },
    { key: "size", header: "Size" },
  ];

  return (
    <Stack gap={3}>
      {error ? <Banner status="error" title="Error" description={error} /> : null}
      <Card>
        {props.indexes.length === 0 ? (
          <EmptyState title="No indexes" description="The _id_ index always exists." />
        ) : (
          <Table
            data={props.indexes.map((index) => ({ ...index, unique: index.unique ? "yes" : "no", size: `${index.sizeBytes} B` })) as never}
            columns={columns as never}
            idKey="name"
            hasHover
          />
        )}
      </Card>
      <Stack direction="horizontal" gap={2}>
        {props.indexes.map((index) => (
          index.name === "_id_" ? null : (
            <Button
              key={index.name}
              label={`Drop ${index.name}`}
              variant="destructive"
              size="sm"
              onClick={() => setDropping(index.name)}
            />
          )
        ))}
      </Stack>
      <Button label="New index" variant="primary" onClick={() => setOpen(true)} />
      <Dialog isOpen={open} onOpenChange={setOpen}>
        <Layout
          header={<DialogHeader title="New index" onOpenChange={setOpen} />}
          content={
            <LayoutContent>
              <Stack gap={3}>
                <TextInput label="Name (optional)" value={name} onChange={setName} />
                <TextArea label="Keys (EJSON)" value={keys} onChange={setKeys} rows={4} />
                <Switch label="Unique" value={unique} onChange={setUnique} />
                <Switch label="Sparse" value={sparse} onChange={setSparse} />
                <Stack direction="horizontal" gap={2} hAlign="end">
                  <Button label="Cancel" variant="secondary" onClick={() => setOpen(false)} />
                  <Button label="Create" variant="primary" onClick={create} />
                </Stack>
              </Stack>
            </LayoutContent>
          }
        />
      </Dialog>
      <AlertDialog
        isOpen={dropping !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDropping(null);
          }
        }}
        title={`Drop index ${dropping ?? ""}?`}
        description="The index is removed from the query planner immediately."
        actionLabel="Drop"
        onAction={drop}
      />
    </Stack>
  );
}

function QueryPlanTab(props: { collection: string; onError: (message: string) => void }) {
  const [filter, setFilter] = useState('{ }');
  const [sort, setSort] = useState('{ "_id": 1 }');
  const [limit, setLimit] = useState(20);
  const [result, setResult] = useState<import("../../server/plans").ExplainResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);

    try {
      const response = await explainQueryFn({
        data: { collection: props.collection, filter, sort, limit },
      });

      if (!response.ok) {
        props.onError(response.error.message);
        return;
      }

      setResult(response.data);
    } finally {
      setLoading(false);
    }
  };


  return (
    <Stack gap={3}>
      <Card>
        <Stack gap={3}>
          <TextInput label="Filter (EJSON)" value={filter} onChange={setFilter} />
          <TextInput label="Sort (EJSON)" value={sort} onChange={setSort} />
          <TextInput
            label="Limit"
            value={String(limit)}
            onChange={(value) => setLimit(Number(value) || 1)}
          />
          <Button label={loading ? "Running" : "Explain"} variant="primary" onClick={run} isDisabled={loading} />
        </Stack>
      </Card>
      {result ? (
        <Card>
          <Stack gap={3}>
            <Heading level={4}>Winning plan</Heading>
            <Stack direction="horizontal" gap={3} wrap="wrap">
              <Text type="label">Stage: {result.summary.stage}</Text>
              <Text type="label">Index: {result.summary.indexName ?? "none"}</Text>
              <Text type="label">Keys examined: {result.summary.keysExamined}</Text>
              <Text type="label">Documents examined: {result.summary.docsExamined}</Text>
              <Text type="label">Returned: {result.summary.returned}</Text>
              <Text type="label">Time: {result.summary.executionTimeMillis} ms</Text>
            </Stack>
            {result.summary.notes.length > 0 ? (
              <Stack gap={1}>
                {result.summary.notes.map((note) => (
                  <Text key={note} type="supporting" color="secondary">
                    {note}
                  </Text>
                ))}
              </Stack>
            ) : null}
            {result.recommendation ? (
              <Stack gap={1}>
                <Text type="label">Suggested index</Text>
                <pre className="mono">{result.recommendation.expression}</pre>
              </Stack>
            ) : null}
            <pre className="mono" style={{ maxHeight: 400, overflow: "auto" }}>
              {result.summary.raw}
            </pre>
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}
