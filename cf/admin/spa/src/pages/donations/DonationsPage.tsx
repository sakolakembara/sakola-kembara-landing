import { Download } from "lucide-react";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { DataTable, type Column } from "~/components/crud/DataTable";
import { FilterBar } from "~/components/crud/FilterBar";
import { Flash } from "~/components/crud/Flash";
import { Pagination } from "~/components/crud/Pagination";
import { StatusTag } from "~/components/crud/StatusTag";
import { PageHeader } from "~/components/PageHeader";
import { describeFailure } from "~/lib/crud/errors";
import { useFlash } from "~/lib/crud/flash";
import { useList } from "~/lib/crud/useList";
import { formatDateTime } from "~/lib/format";
import { API_PATH, type DonationListItem, exportHref, KIND_LABEL, LIST_SPEC, ROUTE, rupiah, STATUS } from "./model";

// Donasi (SAKEM-128): the confirmations of the site's /donasi form, newest first. Four columns only (Dzul's
// wireframe v2): who, how much and how often, when, and where it stands; the WhatsApp number, the source and the receipt
// are in the detail and in the CSV. "Ekspor CSV" downloads the list as filtered now, for the treasurer's spreadsheet.

const COLUMNS: readonly Column<DonationListItem>[] = [
  {
    key: "name",
    header: "Nama",
    cell: (row) => (
      <Link to={`${ROUTE}/${encodeURIComponent(row.id)}`} className="font-medium text-gray-900 hover:text-primary-blue">
        {row.name}
      </Link>
    ),
  },
  {
    key: "amount",
    sort: "amount",
    sortFirst: "desc",
    header: "Donasi",
    className: "whitespace-nowrap",
    cell: (row) => (
      <>
        <span className="font-medium text-gray-900">{rupiah(row.amount)}</span>{" "}
        <span className="text-gray-500">
          · {KIND_LABEL[row.kind].toLowerCase()}
          {row.kind === "monthly" && row.remindDay ? `, tgl ${row.remindDay}` : ""}
        </span>
      </>
    ),
  },
  {
    key: "createdAt",
    sort: "createdAt",
    sortFirst: "desc",
    header: "Masuk",
    className: "whitespace-nowrap text-gray-500",
    cell: (row) => formatDateTime(row.createdAt),
  },
  {
    key: "status",
    header: "Status",
    headerClassName: "text-right",
    className: "text-right",
    cell: (row) => <StatusTag map={STATUS} value={row.status} />,
  },
];

export function DonationsPage() {
  const list = useList<DonationListItem>(API_PATH, LIST_SPEC);
  const notice = useFlash();
  const filtered = list.query.q !== "" || Object.keys(list.query.filters).length > 0;

  return (
    <div className="p-6 md:p-10">
      <PageHeader title="Donasi" />
      <Flash flash={notice.flash} dismiss={notice.dismiss} />

      <FilterBar
        list={list}
        search={{ label: "Cari", placeholder: "Nama atau nomor WhatsApp" }}
        filters={[
          {
            name: "kind",
            label: "Jenis",
            allLabel: "Semua jenis",
            options: [
              { value: "once", label: KIND_LABEL.once },
              { value: "monthly", label: KIND_LABEL.monthly },
            ],
          },
          {
            name: "status",
            label: "Status",
            allLabel: "Semua status",
            options: [
              { value: "awaiting_transfer", label: STATUS.awaiting_transfer.label },
              { value: "new", label: STATUS.new.label },
              { value: "checked", label: STATUS.checked.label },
            ],
          },
        ]}
        trailing={
          <Button variant="neutral" href={exportHref(list.query.filters, list.query.q)} download>
            <Download aria-hidden="true" />
            Ekspor CSV
          </Button>
        }
      />

      <DataTable<DonationListItem>
        caption="Daftar konfirmasi donasi"
        columns={COLUMNS}
        rows={list.items}
        rowKey={(row) => row.id}
        state={list.status}
        refreshing={list.refreshing}
        errorMessage={list.failure ? describeFailure(list.failure).message : undefined}
        onRetry={list.refetch}
        emptyText={filtered ? "Tidak ada donasi yang cocok dengan filter." : "Belum ada konfirmasi donasi dari situs."}
        emptyFiltered={filtered}
        sort={{ value: list.query.sort, onChange: list.setSort }}
      />

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} searchFor={list.searchFor} />
    </div>
  );
}
