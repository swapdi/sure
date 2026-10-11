import { Controller } from "@hotwired/stimulus";

// Keeps key presses inside a control (e.g. a menu in a dashboard section
// header) from reaching the section's keyboard reordering handler.
export default class extends Controller {
  stop(event) {
    event.stopPropagation();
  }
}
