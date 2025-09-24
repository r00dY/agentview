import "./styles.css";
import { renderStudio } from "agentview";
import agentviewConfig from "./agentview.config";

renderStudio(
    document.getElementById("agentview"), 
    agentviewConfig
);