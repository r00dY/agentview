import "~/styles.css";
import { renderStudio } from "~";
import agentviewConfig from "./agentview.config"

renderStudio(
    document.getElementById("agentview"), 
    agentviewConfig
);