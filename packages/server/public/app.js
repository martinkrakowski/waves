"use strict";

const status = document.getElementById("status");
const projects = document.getElementById("projects");

function line(label, value) {
  const item = document.createElement("li");
  const name = document.createElement("span");
  name.textContent = label;
  const id = document.createElement("code");
  id.textContent = value;
  item.append(name, id);
  return item;
}

async function render() {
  const response = await fetch("/api/v1/projects", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    status.textContent = "The project list is not available right now.";
    return;
  }
  const list = await response.json();
  if (list.length === 0) {
    status.textContent = "No projects registered yet.";
    return;
  }
  status.textContent = `${list.length} project(s) registered.`;
  for (const project of list) {
    projects.append(line(project.name, project.id));
  }
}

render();
