import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Stack } from "@astryxdesign/core/Stack";
import { getMigrationsFn, applyMigrationsFn } from "../../server/functions";
import type { MigrationRunResult } from "../../server/migrations";

export const Route = createFileRoute("/migrations/")({
  loader: async () => getMigrationsFn(),
  component: MigrationsPage,
});

function MigrationsPage() {
  const result = Route.useLoaderData();
  const [applying, setApplying] = useState(false);
  const [runResult, setRunResult] = useState<MigrationRunResult | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!result.ok) {
    return <Banner status="error" title="Could not load migrations" description={result.error.message} />;
  }

  const overview = result.data;

  const apply = async () => {
    setApplying(true);
    setError(null);

    try {
      const response = await applyMigrationsFn();

      if (!response.ok) {
        setError(response.error.message);
        return;
      }

      setRunResult(response.data);
      window.location.reload();
    } finally {
      setApplying(false);
      setOpen(false);
    }
  };

  return (
    <Stack gap={4}>
      <Heading level={1}>Migrations</Heading>
      {!overview.configured ? (
        <Banner
          status="info"
          title="No contracts configured"
          description={overview.hint ?? "Set SUPER_MONGOOSE_CONTRACTS to a contract file."}
        />
      ) : null}
      {overview.error ? (
        <Banner status="error" title="Could not load contracts" description={overview.error} />
      ) : null}
      {overview.configured ? (
        <Card>
          <Stack gap={3}>
            <Heading level={4}>Contracts</Heading>
            <Text type="supporting">Files: {overview.files.join(", ") || "none"}</Text>
            <Stack gap={2}>
              {overview.contracts.map((contract) => (
                <Card key={contract.version}>
                  <Stack gap={1}>
                    <Text type="label">Version {contract.version}</Text>
                    {contract.models.map((model) => (
                      <Text key={model.name} type="supporting">
                        {model.name} ({model.collection}) - {model.fields} fields, {model.indexes} indexes
                      </Text>
                    ))}
                  </Stack>
                </Card>
              ))}
            </Stack>
            <Stack direction="horizontal" gap={2} wrap="wrap">
              <Text type="label">Applied: {overview.applied?.length ?? 0}</Text>
              <Text type="label">Pending: {overview.pending?.join(", ") || "none"}</Text>
              <Text type="label">Operations: {overview.operations ?? 0}</Text>
            </Stack>
            {(overview.conflicts?.length ?? 0) > 0 ? (
              <Banner status="error" title="Conflicts" description={overview.conflicts?.join("; ")} />
            ) : null}
            {(overview.advisories?.length ?? 0) > 0 ? (
              <Stack gap={1}>
                {overview.advisories?.map((advisory) => (
                  <Text key={advisory} type="supporting" color="secondary">
                    {advisory}
                  </Text>
                ))}
              </Stack>
            ) : null}
            {overview.operationList && overview.operationList.length > 0 ? (
              <Stack gap={1}>
                <Heading level={5}>Pending operations</Heading>
                {overview.operationList.map((operation, index) => (
                  <Text key={`${operation.type}-${index}`} type="supporting">
                    {operation.type} {operation.collection}
                    {operation.name ? ` ${operation.name}` : ""}
                  </Text>
                ))}
              </Stack>
            ) : null}
            <Stack direction="horizontal" gap={2}>
              <Button
                label={applying ? "Applying" : "Apply migrations"}
                variant="primary"
                onClick={() => setOpen(true)}
                isDisabled={
                  applying ||
                  overview.pending?.length === 0 ||
                  (overview.conflicts?.length ?? 0) > 0
                }
              />
            </Stack>
          </Stack>
        </Card>
      ) : null}
      {overview.applied && overview.applied.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Heading level={4}>Ledger</Heading>
            {overview.applied.map((row) => (
              <Text key={row.version} type="supporting">
                {row.version} at {row.appliedAt}
              </Text>
            ))}
          </Stack>
        </Card>
      ) : null}
      {error ? <Banner status="error" title="Could not apply" description={error} /> : null}
      {runResult ? (
        <Banner
          status="success"
          title={`Applied ${runResult.applied.length} version(s)`}
          description={runResult.applied.join(", ")}
        />
      ) : null}
      <AlertDialog
        isOpen={open}
        onOpenChange={setOpen}
        title="Apply migrations?"
        description="The declared contracts are applied to the database and recorded in the ledger."
        actionLabel="Apply"
        onAction={apply}
        isActionLoading={applying}
      />
    </Stack>
  );
}
