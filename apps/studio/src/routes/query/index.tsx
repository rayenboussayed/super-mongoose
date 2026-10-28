import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Stack } from "@astryxdesign/core/Stack";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { listCollectionsFn, explainQueryFn } from "../../server/functions";

export const Route = createFileRoute("/query/")({
  loader: async () => listCollectionsFn(),
  component: QueryPage,
});

function QueryPage() {
  const result = Route.useLoaderData();
  const [collection, setCollection] = useState("");
  const [filter, setFilter] = useState('{ }');
  const [sort, setSort] = useState('{ "_id": 1 }');
  const [limit, setLimit] = useState(20);
  const [explain, setExplain] = useState<import("../../server/plans").ExplainResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!result.ok) {
    return <Banner status="error" title="Could not load collections" description={result.error.message} />;
  }

  if (collection === "" && (result.data?.length ?? 0) > 0) {
    setCollection(result.data[0]?.name ?? "");
  }

  const run = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await explainQueryFn({
        data: { collection, filter, sort, limit },
      });

      if (!response.ok) {
        setError(response.error.message);
        return;
      }

      setExplain(response.data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack gap={4}>
      <Heading level={1}>Query lab</Heading>
      {error ? <Banner status="error" title="Error" description={error} /> : null}
      <Card>
        <Stack gap={3}>
          <TextInput label="Collection" value={collection} onChange={setCollection} />
          <TextInput label="Filter (EJSON)" value={filter} onChange={setFilter} />
          <TextInput label="Sort (EJSON)" value={sort} onChange={setSort} />
          <TextInput label="Limit" value={String(limit)} onChange={(value) => setLimit(Number(value) || 1)} />
          <Button label={loading ? "Running" : "Explain"} variant="primary" onClick={run} isDisabled={loading} />
        </Stack>
      </Card>
      <Stack direction="horizontal" gap={2} wrap="wrap">
        {result.data.map((entry) => (
          <Button key={entry.name} label={entry.name} size="sm" variant={entry.name === collection ? "primary" : "secondary"} onClick={() => setCollection(entry.name)} />
        ))}
      </Stack>
      {explain ? (
        <Card>
          <Stack gap={3}>
            <Text type="label">Stage {explain.summary.stage}</Text>
            <Text type="label">Index {explain.summary.indexName ?? "none"}</Text>
            <Text type="label">Keys examined {explain.summary.keysExamined}</Text>
            <Text type="label">Documents examined {explain.summary.docsExamined}</Text>
            <Text type="label">Returned {explain.summary.returned}</Text>
            <Text type="label">Time {explain.summary.executionTimeMillis} ms</Text>
            {explain.recommendation ? <pre className="mono">{explain.recommendation.expression}</pre> : null}
            <pre className="mono" style={{ maxHeight: 400, overflow: "auto" }}>
              {explain.summary.raw}
            </pre>
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}
