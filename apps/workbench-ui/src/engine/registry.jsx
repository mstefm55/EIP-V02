import SurfaceRoot from "../components/primitives/SurfaceRoot.jsx";
import PanelHeader from "../components/primitives/PanelHeader.jsx";
import SplitLayout from "../components/primitives/SplitLayout.jsx";
import Tabs from "../components/primitives/Tabs.jsx";
import ContractDetailEditor from "../components/primitives/ContractDetailEditor.jsx";
import ContractTablePanel from "../components/primitives/ContractTablePanel.jsx";
import ContractRecordEditor from "../components/primitives/ContractRecordEditor.jsx";
import ContractMetricGrid from "../components/primitives/ContractMetricGrid.jsx";
import NoticePanel from "../components/primitives/NoticePanel.jsx";
import SelectionDetailPanel from "../components/primitives/SelectionDetailPanel.jsx";
import FallbackNode from "../components/primitives/FallbackNode.jsx";

// Primitive library is intentionally generic and domain-agnostic.
const primitiveLibrary = Object.freeze({
  SurfaceRoot: Object.freeze({
    component: SurfaceRoot,
    contract: "surface_root_v1",
  }),
  PanelHeader: Object.freeze({
    component: PanelHeader,
    contract: "panel_header_v1",
  }),
  SplitLayout: Object.freeze({
    component: SplitLayout,
    contract: "split_layout_v1",
  }),
  Tabs: Object.freeze({
    component: Tabs,
    contract: "tabs_v1",
  }),
  ContractTablePanel: Object.freeze({
    component: ContractTablePanel,
    contract: "contract_table_panel_v1",
  }),
  ContractRecordEditor: Object.freeze({
    component: ContractRecordEditor,
    contract: "contract_record_editor_v1",
  }),
  ContractDetailEditor: Object.freeze({
    component: ContractDetailEditor,
    contract: "contract_detail_editor_v1",
  }),
  ContractMetricGrid: Object.freeze({
    component: ContractMetricGrid,
    contract: "contract_metric_grid_v1",
  }),
  NoticePanel: Object.freeze({
    component: NoticePanel,
    contract: "notice_panel_v1",
  }),
  SelectionDetailPanel: Object.freeze({
    component: SelectionDetailPanel,
    contract: "selection_detail_panel_v1",
  }),
  Fallback: Object.freeze({
    component: FallbackNode,
    contract: "fallback_node_v1",
  }),
});

const compositeLibrary = Object.freeze({});

const registry = Object.freeze(
  Object.fromEntries(
    [...Object.entries(primitiveLibrary), ...Object.entries(compositeLibrary)].map(
      ([key, entry]) => [key, entry.component]
    )
  )
);

export { compositeLibrary, primitiveLibrary, registry };
