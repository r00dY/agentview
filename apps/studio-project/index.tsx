import "./styles.css";
import { renderStudio } from "@agentview/studio/index";
import { config } from "./agentview.config";

renderStudio(
    document.getElementById("agentview"), 
    config
);