import Register, { money } from '../components/Register.jsx';

const TYPES = ['Supply', 'Project', 'Service'];
const typeChip = (r) => <span className="pill">{r.type}</span>;
const projectCode = (r) => r.project_code ?? <span className="muted small">n/a · {r.type}</span>;
const statusChip = (r) => <span className={`status-chip s-${String(r.status).toLowerCase().replace(/\s/g, '-')}`}>{r.status}</span>;

const CUSTOMER_PO = {
  endpoint: 'customer-pos',
  dated: true,
  idKey: 'po_no',
  title: 'Purchase Orders',
  subtitle: 'Purchase orders received from customers, and where each one stands',
  addLabel: 'Record PO',
  searchPlaceholder: 'Search PO number, customer',
  empty: 'No purchase orders in this period. Use the arrows to look at another month.',
  filters: [{ key: 'customer', label: 'Customer' }, { key: 'status', label: 'Status', options: ['Open', 'Processed', 'On hold', 'Cancelled'] }, { key: 'type', label: 'Type', options: TYPES }],
  cards: (s) => [
    { label: 'Orders', value: s.orders },
    { label: 'Total value', value: money(s.total), hint: 'Including cancelled' },
    { label: 'Live value', value: money(s.live), tone: 'blue', hint: 'Cancelled excluded' },
    { label: 'Invoiced', value: money(s.invoiced), tone: 'green' },
    { label: 'On hold', value: money(s.onHold), tone: 'amber' },
  ],
  columns: [
    { key: 'customer', label: 'Customer' },
    { key: 'po_no', label: 'PO No.', render: (r) => <strong>{r.po_no}</strong> },
    { key: 'po_date', label: 'PO Date' },
    { key: 'value', label: 'PO Value', right: true, render: (r) => r.value.toLocaleString('en-IN', { minimumFractionDigits: 2 }) },
    { key: 'type', label: 'Type', render: typeChip },
    { key: 'project_code', label: 'Project Code', render: projectCode },
    { key: 'status', label: 'Status', render: statusChip },
  ],
  form: [
    { key: 'customer', label: 'Customer', required: true },
    { key: 'po_no', label: 'PO number', required: true },
    { key: 'po_date', label: 'PO date', type: 'date', required: true },
    { key: 'value', label: 'PO value (₹, excl. GST)', type: 'number', required: true },
    { key: 'type', label: 'Type', type: 'select', options: TYPES, required: true, default: 'Supply' },
    { key: 'project_code', label: 'Project code' },
    { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Processed', 'On hold', 'Cancelled'], required: true, default: 'Open' },
    { key: 'invoiced', label: 'Invoiced so far (₹)', type: 'number' },
  ],
};

const VENDOR_PO = {
  endpoint: 'vendor-pos',
  dated: true,
  idKey: 'po_no',
  title: 'Supplier POs',
  subtitle: 'Purchase orders raised on suppliers, with what has been paid against each',
  addLabel: 'Record PO',
  searchPlaceholder: 'Search PO number, supplier',
  empty: 'No supplier POs in this period. Use the arrows to look at another month.',
  filters: [{ key: 'vendor', label: 'Supplier' }, { key: 'status', label: 'Status', options: ['Open', 'Processed', 'Invoiced', 'Cancelled'] }, { key: 'type', label: 'Type', options: TYPES }],
  cards: (s) => [
    { label: 'Orders', value: s.orders },
    { label: 'Total value', value: money(s.total) },
    { label: 'Paid', value: money(s.paid), tone: 'green' },
    { label: 'Outstanding', value: money(s.outstanding), tone: 'red' },
    { label: 'Unpaid POs', value: s.unpaid, tone: 'amber' },
  ],
  columns: [
    { key: 'vendor', label: 'Supplier' },
    { key: 'po_no', label: 'PO No.', render: (r) => <strong>{r.po_no}</strong> },
    { key: 'po_date', label: 'PO Date' },
    { key: 'value', label: 'PO Value', right: true, render: (r) => r.value.toLocaleString('en-IN', { minimumFractionDigits: 2 }) },
    { key: 'type', label: 'Type', render: typeChip },
    { key: 'project_code', label: 'Project Code', render: projectCode },
    { key: 'status', label: 'Status', render: statusChip },
    { key: 'payment', label: 'Payment', render: (r) => <span className={`status-chip s-${r.payment.toLowerCase()}`}>{r.payment}</span> },
    { key: 'balance', label: 'Balance', right: true, render: (r) => r.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 }) },
  ],
  form: [
    { key: 'vendor', label: 'Supplier', required: true },
    { key: 'po_no', label: 'PO number', required: true },
    { key: 'po_date', label: 'PO date', type: 'date', required: true },
    { key: 'value', label: 'PO value (₹, excl. GST)', type: 'number', required: true },
    { key: 'type', label: 'Type', type: 'select', options: TYPES, required: true, default: 'Supply' },
    { key: 'project_code', label: 'Project code' },
    { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Processed', 'Invoiced', 'Cancelled'], required: true, default: 'Open' },
    { key: 'paid', label: 'Paid so far (₹)', type: 'number' },
  ],
};

const SALES = {
  endpoint: 'sales',
  dated: true,
  idKey: 'po_no',
  title: 'Sales',
  subtitle: 'The sales register, per engineer, with profit on every order',
  addLabel: 'Record order',
  searchPlaceholder: 'Search PO no., customer, invoice',
  empty: 'No sales orders in this period. Use the arrows to look at another month.',
  note: () => 'You see your own sales book. Managers see their team’s orders and the boss sees every engineer’s.',
  filters: [{ key: 'customer', label: 'Customer' }, { key: 'type', label: 'Type', options: TYPES }, { key: 'engineer_id', label: 'Sales engineer' }],
  cards: (s) => [
    { label: 'Orders', value: s.orders },
    { label: 'PO value', value: money(s.poValue) },
    { label: 'Invoiced', value: money(s.invoiced), tone: 'blue' },
    { label: 'Purchase', value: money(s.purchase) },
    { label: 'Profit', value: money(s.profit), tone: s.profit < 0 ? 'red' : 'green', hint: 'PO value − purchase' },
  ],
  columns: [
    { key: 'engineer', label: 'Sales Engineer' },
    { key: 'customer', label: 'Customer' },
    { key: 'po_no', label: 'Customer PO No.', render: (r) => <strong>{r.po_no}</strong> },
    { key: 'po_date', label: 'PO Date' },
    { key: 'value', label: 'PO Value', right: true, render: (r) => r.value.toLocaleString('en-IN', { minimumFractionDigits: 2 }) },
    { key: 'type', label: 'Type', render: typeChip },
    { key: 'project_code', label: 'Project', render: projectCode },
    { key: 'invoice_no', label: 'Invoice No.' },
    { key: 'invoice_date', label: 'Invoice Date' },
    { key: 'invoice_value', label: 'Invoice Value', right: true, render: (r) => r.invoice_value.toLocaleString('en-IN', { minimumFractionDigits: 2 }) },
    { key: 'purchase_cost', label: 'Purchase', right: true, render: (r) => r.purchase_cost.toLocaleString('en-IN', { minimumFractionDigits: 2 }) },
    { key: 'profit', label: 'Profit', right: true, render: (r) => <strong className={r.profit < 0 ? 'neg' : 'pos'}>{r.profit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong> },
  ],
  form: [
    { key: 'customer', label: 'Customer', required: true },
    { key: 'po_no', label: 'Customer PO number', required: true },
    { key: 'po_date', label: 'PO date', type: 'date', required: true },
    { key: 'value', label: 'PO value (₹, excl. GST)', type: 'number', required: true },
    { key: 'type', label: 'Type', type: 'select', options: TYPES, required: true, default: 'Supply' },
    { key: 'project_code', label: 'Project code' },
    { key: 'invoice_no', label: 'Invoice number' },
    { key: 'invoice_date', label: 'Invoice date', type: 'date' },
    { key: 'invoice_value', label: 'Invoice value (₹)', type: 'number' },
    { key: 'purchase_cost', label: 'Purchase cost (₹)', type: 'number' },
  ],
};

const PROJECTS = {
  endpoint: 'projects',
  dated: false,
  mine: true,
  idKey: 'code',
  title: 'Projects',
  subtitle: 'Every project, its owner and where it stands',
  addLabel: 'New project',
  searchPlaceholder: 'Search projects…',
  empty: 'No projects yet.',
  filters: [{ key: 'status', label: 'Status', options: ['Active', 'Completed', 'On hold', 'Cancelled'] }, { key: 'customer', label: 'Customer' }],
  cards: (s) => [
    { label: 'Total projects', value: s.total, tone: 'blue' },
    { label: 'Active', value: s.active, tone: 'green' },
    { label: 'Completed', value: s.completed, tone: 'blue' },
    { label: 'Overdue', value: s.overdue, tone: 'red' },
    { label: 'Due this week', value: s.dueThisWeek, tone: 'amber' },
  ],
  columns: [
    { key: 'code', label: 'Code', render: (r) => <strong>{r.code}</strong> },
    { key: 'name', label: 'Project' },
    { key: 'customer', label: 'Customer' },
    { key: 'owner', label: 'Owner' },
    { key: 'due_date', label: 'Due' },
    { key: 'status', label: 'Status', render: statusChip },
  ],
  form: [
    { key: 'code', label: 'Project code', required: true },
    { key: 'name', label: 'Project name', required: true },
    { key: 'customer', label: 'Customer' },
    { key: 'owner_id', label: 'Owner', type: 'select', options: [] },
    { key: 'due_date', label: 'Due date', type: 'date' },
    { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Completed', 'On hold', 'Cancelled'], required: true, default: 'Active' },
  ],
};

export const PurchaseOrders = () => <Register config={CUSTOMER_PO} />;
export const SupplierPOs = () => <Register config={VENDOR_PO} />;
export const Sales = () => <Register config={SALES} />;
export const Projects = () => <Register config={PROJECTS} />;
