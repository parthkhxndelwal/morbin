"use client";

import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  SearchIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/patterns/states";
import { cn } from "@/lib/utils";

export interface DataTableFilter {
  /** Column id the filter applies to (exact match on the cell value). */
  columnId: string;
  label: string;
  options: { label: string; value: string }[];
}

export interface DataTableViewState {
  search: string;
  filters: Record<string, string>;
  visibleColumns: string[];
}

/**
 * The one table every dashboard list uses.
 *
 * Built in: search, select filters, sorting, column chooser, pagination, row
 * links, an export button that receives the current view, and three distinct
 * empty states — no data at all, no rows matching the filters (with a reset),
 * and the caller's own empty content.
 */
export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder = "Search…",
  filters = [],
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  rowHref,
  onRowClick,
  exportHref,
  toolbar,
  pageSize = 20,
  initialSorting = [],
  initialHidden = {},
}: {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  searchPlaceholder?: string | null;
  filters?: DataTableFilter[];
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  emptyAction?: React.ReactNode;
  /** Makes each row navigate on click (keyboard: Enter). */
  rowHref?: (row: TData) => string;
  /** Alternative to rowHref: open something (a sheet, a dialog) for the row. */
  onRowClick?: (row: TData) => void;
  /** Build the server export URL for exactly what is on screen. */
  exportHref?: (view: DataTableViewState) => string;
  /** Extra controls, right-aligned in the toolbar. */
  toolbar?: React.ReactNode;
  pageSize?: number;
  initialSorting?: SortingState;
  initialHidden?: VisibilityState;
}) {
  // TanStack's table instance returns fresh functions each render; let the
  // React Compiler leave this component alone rather than memoize stale ones.
  "use no memo";
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialHidden);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: "includesString",
    initialState: { pagination: { pageSize } },
  });

  const filtered = globalFilter !== "" || columnFilters.length > 0;
  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;

  const view = useMemo<DataTableViewState>(
    () => ({
      search: globalFilter,
      filters: Object.fromEntries(columnFilters.map((f) => [f.id, String(f.value)])),
      visibleColumns: table
        .getVisibleLeafColumns()
        .map((c) => c.id)
        .filter((id) => id !== "actions"),
    }),
    // `columnVisibility` is what changes the visible set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [globalFilter, columnFilters, columnVisibility],
  );

  function reset() {
    setGlobalFilter("");
    setColumnFilters([]);
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border">
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </div>
    );
  }

  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide());

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {searchPlaceholder !== null && (
          <InputGroup className="sm:max-w-xs">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label="Search"
            />
          </InputGroup>
        )}
        {filters.map((f) => {
          const column = table.getColumn(f.columnId);
          if (!column) return null;
          return (
            <NativeSelect
              key={f.columnId}
              aria-label={f.label}
              value={(column.getFilterValue() as string) ?? ""}
              onChange={(e) => column.setFilterValue(e.target.value || undefined)}
              className="sm:w-44"
            >
              <NativeSelectOption value="">{f.label}: All</NativeSelectOption>
              {f.options.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          );
        })}
        {filtered && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <XIcon data-icon="inline-start" />
            Reset
          </Button>
        )}
        <div className="flex items-center gap-2 sm:ml-auto">
          {toolbar}
          {hideable.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                <Settings2Icon data-icon="inline-start" />
                Columns
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {hideable.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(v) => column.toggleVisibility(!!v)}
                  >
                    {typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {exportHref && (
            <Button
              variant="outline"
              size="sm"
              render={<a href={exportHref(view)} download />}
              nativeButton={false}
            >
              <DownloadIcon data-icon="inline-start" />
              Export
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="bg-muted/40 hover:bg-muted/40">
                {group.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const label = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                      }
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="-ml-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground"
                        >
                          {label}
                          {sorted === "asc" ? (
                            <ArrowUpIcon className="size-3.5" />
                          ) : sorted === "desc" ? (
                            <ArrowDownIcon className="size-3.5" />
                          ) : (
                            <ArrowUpDownIcon className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        label
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((row) => {
                const href = rowHref?.(row.original);
                const activate = href
                  ? () => router.push(href)
                  : onRowClick
                    ? () => onRowClick(row.original)
                    : null;
                return (
                  <TableRow
                    key={row.id}
                    className={cn(activate && "cursor-pointer")}
                    onClick={
                      activate
                        ? (e) => {
                            // Let buttons/links inside the row do their own thing.
                            if ((e.target as HTMLElement).closest("a,button,[role=menuitem]")) return;
                            activate();
                          }
                        : undefined
                    }
                    onKeyDown={activate ? (e) => e.key === "Enter" && activate() : undefined}
                    tabIndex={activate ? 0 : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-40">
                  <EmptyState
                    title="No matching results"
                    description="Try a different search or clear the filters."
                    action={
                      <Button variant="outline" size="sm" onClick={reset}>
                        Clear filters
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {total === data.length ? `${total} total` : `${total} of ${data.length}`}
        </span>
        {table.getPageCount() > 1 && (
          <div className="flex items-center gap-2">
            <span className="tabular-nums">
              Page {pageIndex + 1} of {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRightIcon />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
