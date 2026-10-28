import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Text";
import { Stack } from "@astryxdesign/core/Stack";
import { Table, proportional } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { listCollectionsFn, createCollectionFn } from "../../server/functions";
import type { CollectionSummary } from "../../server/collections";

export const Route = createFileRoute("/collections/")({
  loader: async () => listCollectionsFn(),
  component: CollectionsPage,
});

interface CollectionRow extends Record<string, unknown> {
  name: string;
  type: string;
  documents: number;
  indexes: number;
}

const columns: TableColumn<CollectionRow>[] = [
  { key: "name", header: "Collection", width: proportional(2) },
  { key: "type", header: "Type", width: proportional(1) },
  { key: "documents", header: "Documents", width: proportional(1) },
  { key: "indexes", header: "Indexes", width: proportional(1) },
];

function CollectionsPage() {
  const result = Route.useLoaderData();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [validator, setValidator] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!result.ok) {
    return <Banner status="error" title="Could not load collections" description={result.error.message} />;
  }

  const visible = result.data.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );
  const rows: CollectionRow[] = visible.map((item: CollectionSummary) => ({
    name: item.name,
    type: item.type,
    documents: item.documents,
    indexes: item.indexes,
  }));

  const create = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await createCollectionFn({
        data: { name, validator: validator.trim() ? validator : undefined },
      });

      if (!response.ok) {
        setError(response.error.message);
        return;
      }

      setOpen(false);
      setName("");
      setValidator("");
      window.location.reload();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack gap={4}>
      <Heading level={1}>Collections</Heading>
      <Stack direction="horizontal" gap={2} hAlign="between" vAlign="center" wrap="wrap">
        <TextInput label="Search" value={search} onChange={setSearch} width={300} isLabelHidden />
        <Button label="New collection" variant="primary" onClick={() => setOpen(true)} />
      </Stack>
      {error ? <Banner status="error" title="Error" description={error} /> : null}
      {visible.length === 0 ? (
        <EmptyState title="No collections" description="Create the first collection to get started." />
      ) : (
        <Card>
          <Table
            data={rows}
            columns={columns}
            idKey="name"
            hasHover
          />
        </Card>
      )}
      <Stack direction="horizontal" gap={2} wrap="wrap">
        {visible.map((item) => (
          <Button
            key={item.name}
            label={`Open ${item.name}`}
            variant="secondary"
            size="sm"
            onClick={() => navigate({ to: "/collections/$collection", params: { collection: item.name } })}
          />
        ))}
      </Stack>
      <Dialog isOpen={open} onOpenChange={setOpen}>
        <Layout
          header={<DialogHeader title="New collection" onOpenChange={setOpen} />}
          content={
            <LayoutContent>
              <Stack gap={3}>
                <TextInput label="Name" value={name} onChange={setName} />
                <TextArea
                  label="Validator (optional)"
                  value={validator}
                  onChange={setValidator}
                  rows={6}
                  placeholder='{ "$jsonSchema": { "bsonType": "object" } }'
                />
              </Stack>
              <Stack direction="horizontal" gap={2} hAlign="end" style={{ marginTop: 12 }}>
                <Button label="Cancel" variant="secondary" onClick={() => setOpen(false)} />
                <Button label={loading ? "Creating" : "Create"} variant="primary" onClick={create} isDisabled={loading} />
              </Stack>
            </LayoutContent>
          }
        />
      </Dialog>
    </Stack>
  );
}
