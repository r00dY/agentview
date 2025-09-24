import "./styles.css";
import { renderStudio } from "agentview/index";
import { config } from "./agentview.config";

renderStudio(
    document.getElementById("agentview"), 
    config
);