import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TableHint } from "@/app/(admin)/admin/_table-hint";
import { Table, TableCard, TBody, Td, Th, THead } from "./table";
import { Tag } from "./tag";

const rows = [
  { name: "Contoh Pendaftar", school: "SMAN 1 Contoh", batch: "Gen 6", status: { label: "Dalam Review", tone: "blue" } },
  { name: "Contoh Pendaftar Dua", school: "MAN 2 Contoh", batch: "Gen 6", status: { label: "Diterima", tone: "green" } },
  { name: "Contoh Pendaftar Tiga", school: "SMKN 3 Contoh", batch: "Gen 6", status: { label: "Ditolak", tone: "red" } },
] as const;

const meta = {
  title: "Molecules/Table",
  component: Table,
  tags: ["autodocs"],
  args: { children: null },
  globals: { backgrounds: { value: "gray" } },
  render: () => (
    <TableCard>
      <Table>
        <TableHint />
        <THead>
          <tr>
            <Th>Nama</Th>
            <Th>Sekolah</Th>
            <Th>Batch</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <tr key={row.name} className="transition-colors hover:bg-gray-50">
              <Td className="font-medium text-gray-900">{row.name}</Td>
              <Td className="text-gray-600">{row.school}</Td>
              <Td className="text-gray-600">{row.batch}</Td>
              <Td>
                <Tag tone={row.status.tone} size="sm">
                  {row.status.label}
                </Tag>
              </Td>
              <Td>
                <a href="#" className="font-medium text-primary-blue hover:underline">
                  Detail
                </a>
              </Td>
            </tr>
          ))}
        </TBody>
      </Table>
    </TableCard>
  ),
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Admin data tables (`TableCard`, `Table`, `THead`, `Th`, `TBody`, `Td`). */
export const Default: Story = {};

/**
 * On a phone every column stays; the table scrolls sideways inside its card,
 * and the admin `TableHint` caption says so (hidden from `md` up).
 */
export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
