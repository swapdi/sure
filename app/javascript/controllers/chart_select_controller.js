import { Controller } from "@hotwired/stimulus";

// Lets an element outside a multi-series chart (e.g. a balance sheet row)
// switch the chart to one of its lines.
export default class extends Controller {
  select(event) {
    event.preventDefault();
    event.stopPropagation();

    window.dispatchEvent(
      new CustomEvent("multi-series-chart:select", {
        detail: { chart: event.params.chart, line: event.params.line },
      }),
    );
  }
}
