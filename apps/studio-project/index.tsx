import "./styles.css";
import { renderStudio } from "agentview";
import { config } from "./agentview.config";

renderStudio(
    document.getElementById("agentview"), 
    config
);