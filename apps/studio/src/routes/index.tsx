import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Stack } from "@astryxdesign/core/Stack";
import { Card } from "@astryxdesign/core/Card";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Table, proportional } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { getOverviewFn } from "../server/functions";
import type { CollectionSummary } from "../server/collections";

export const Route = createFileRoute("/")({
  loader: async () => getOverviewFn(),
  component: DashboardPage,
});

interface CollectionRow extends Record<string, unknown> {
  name: string;
  type: string;
  documents: number;
  indexes: number;
  size: string;
}

const columns: TableColumn<CollectionRow>[] = [
  { key: "name", header: "Collection", width: proportional(2) },
  { key: "type", header: "Type", width: proportional(1) },
  { key: "documents", header: "Documents", width: proportional(1) },
  { key: "indexes", header: "Indexes", width: proportional(1) },
  { key: "size", header: "Size", width: proportional(1) },
];

function DashboardPage() {
  const result = Route.useLoaderData();
  const navigate = useNavigate();
void navigate;
  if (!result.ok) {
    return (
      <Banner status="error" title="Could not load the overview" description={result.error.message} />
    );
  }

  const overview = result.data;
  const collectionRows: CollectionRow[] = overview.collections.map((entry: CollectionSummary) => ({
    name: entry.name,
    type: entry.type,
    documents: entry.documents,
    indexes: entry.indexes,
    size: formatBytes(entry.sizeBytes),
  }));

  return (
    <Stack gap={4}>
      <Heading level={1}>Dashboard</Heading>
      {overview.readOnly ? (
        <Banner status="warning" title="Read only" description="The studio is running with STUDIO_READ_ONLY=1." />
      ) : null}
      <div className="stat-grid">
        <StatCard label="Collections" value={String(overview.collectionsCount)} />
        <StatCard label="Views" value={String(overview.viewsCount)} />
        <StatCard label="Documents" value={String(overview.documentsCount)} />
        <StatCard label="Indexes" value={String(overview.indexesCount)} />
        <StatCard label="Storage" value={formatBytes(overview.storageBytes)} />
        <StatCard label="MongoDB" value={overview.serverVersion} />
      </div>
      <MetadataList>
        <MetadataListItem label="Database">{overview.database}</MetadataListItem>
        <MetadataListItem label="Connection">{overview.uriDisplay}</MetadataListItem>
        <MetadataListItem label="Migrations">
          {overview.migrations.configured
            ? `${overview.migrations.applied?.length ?? 0} applied, ${overview.migrations.pending?.length ?? 0} pending`
            : "Not configured"}
        </MetadataListItem>
      </MetadataList>
      <Card>
        {collectionRows.length === 0 ? (
          <EmptyState title="No collections yet" description="Create one from the Collections page." />
        ) : (
          <Table
            data={collectionRows}
            columns={columns}
            idKey="name"
            hasHover
          />
        )}
      </Card>
    </Stack>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card padding={3}>
      <Stack gap={1}>
        <Text type="supporting" color="secondary">
          {label}
        </Text>
        <Heading level={4}>{value}</Heading>
      </Stack>
    </Card>
  );
}

function formatBytes(size: number): string {
  if (size === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let remaining = size;
  let index = 0;

  while (remaining >= 1024 && index < units.length - 1) {
    remaining /= 1024;
    index += 1;
  }

  return `${remaining.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
