import React, {
  useState,
  useEffect,
  useReducer,
  useCallback,
  useContext,
} from "react";
import { toast } from "react-toastify";

import { makeStyles } from "@material-ui/core/styles";
import Paper from "@material-ui/core/Paper";
import Button from "@material-ui/core/Button";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import IconButton from "@material-ui/core/IconButton";
import SearchIcon from "@material-ui/icons/Search";
import TextField from "@material-ui/core/TextField";
import InputAdornment from "@material-ui/core/InputAdornment";

import DeleteOutlineIcon from "@material-ui/icons/DeleteOutline";
import EditIcon from "@material-ui/icons/Edit";

import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import Title from "../../components/Title";

import api from "../../services/api";
import { i18n } from "../../translate/i18n";
import TableRowSkeleton from "../../components/TableRowSkeleton";
import CustomColumnModal from "../../components/CustomColumnModal";
import ConfirmationModal from "../../components/ConfirmationModal";
import toastError from "../../errors/toastError";
import { socketConnection } from "../../services/socket";
import { AuthContext } from "../../context/Auth/AuthContext";

const reducer = (state, action) => {
  if (action.type === "LOAD_CUSTOM_COLUMNS") {
    const customColumns = action.payload;
    const newCustomColumns = [];

    customColumns.forEach((customColumn) => {
      const customColumnIndex = state.findIndex((c) => c.id === customColumn.id);
      if (customColumnIndex !== -1) {
        state[customColumnIndex] = customColumn;
      } else {
        newCustomColumns.push(customColumn);
      }
    });

    return [...state, ...newCustomColumns];
  }

  if (action.type === "UPDATE_CUSTOM_COLUMNS") {
    const customColumn = action.payload;
    const customColumnIndex = state.findIndex((c) => c.id === customColumn.id);

    if (customColumnIndex !== -1) {
      state[customColumnIndex] = customColumn;
      return [...state];
    } else {
      return [customColumn, ...state];
    }
  }

  if (action.type === "DELETE_CUSTOM_COLUMN") {
    const customColumnId = action.payload;

    const customColumnIndex = state.findIndex((c) => c.id === customColumnId);
    if (customColumnIndex !== -1) {
      state.splice(customColumnIndex, 1);
    }
    return [...state];
  }

  if (action.type === "RESET") {
    return [];
  }
};

const useStyles = makeStyles((theme) => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(1),
    overflowY: "scroll",
    ...theme.scrollbarStyles,
  },
}));

const CustomColumns = () => {
  const classes = useStyles();

  const { user } = useContext(AuthContext);

  const [loading, setLoading] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selectedCustomColumn, setSelectedCustomColumn] = useState(null);
  const [deletingCustomColumn, setDeletingCustomColumn] = useState(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [searchParam, setSearchParam] = useState("");
  const [customColumns, dispatch] = useReducer(reducer, []);
  const [customColumnModalOpen, setCustomColumnModalOpen] = useState(false);

  const fetchCustomColumns = useCallback(async () => {
    try {
      const { data } = await api.get("/custom-columns/", {
        params: { searchParam, pageNumber },
      });
      dispatch({ type: "LOAD_CUSTOM_COLUMNS", payload: data.customColumns });
      setHasMore(data.hasMore);
      setLoading(false);
    } catch (err) {
      toastError(err);
    }
  }, [searchParam, pageNumber]);

  useEffect(() => {
    dispatch({ type: "RESET" });
    setPageNumber(1);
  }, [searchParam]);

  useEffect(() => {
    setLoading(true);
    const delayDebounceFn = setTimeout(() => {
      fetchCustomColumns();
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [
    searchParam,
    pageNumber,
    fetchCustomColumns,
  ]);

  useEffect(() => {
    const socket = socketConnection({ companyId: user.companyId });

    socket.on("customColumn", (data) => {
      if (data.action === "update" || data.action === "create") {
        dispatch({ type: "UPDATE_CUSTOM_COLUMNS", payload: data.customColumn });
      }

      if (data.action === "delete") {
        dispatch({ type: "DELETE_CUSTOM_COLUMN", payload: +data.customColumnId });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [user]);

  const handleOpenCustomColumnModal = () => {
    setSelectedCustomColumn(null);
    setCustomColumnModalOpen(true);
  };

  const handleCloseCustomColumnModal = () => {
    setSelectedCustomColumn(null);
    setCustomColumnModalOpen(false);
  };

  const handleSearch = (event) => {
    setSearchParam(event.target.value.toLowerCase());
  };

  const handleEditCustomColumn = (customColumn) => {
    setSelectedCustomColumn(customColumn);
    setCustomColumnModalOpen(true);
  };

  const handleDeleteCustomColumn = async (customColumnId) => {
    try {
      await api.delete(`/custom-columns/${customColumnId}`);
      toast.success("Coluna personalizada deletada com sucesso!");
    } catch (err) {
      toastError(err);
    }
    setDeletingCustomColumn(null);
    setSearchParam("");
    setPageNumber(1);

    dispatch({ type: "RESET" });
    setPageNumber(1);
    await fetchCustomColumns();
  };

  const loadMore = () => {
    setPageNumber((prevState) => prevState + 1);
  };

  const handleScroll = (e) => {
    if (!hasMore || loading) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - (scrollTop + 100) < clientHeight) {
      loadMore();
    }
  };

  const truncate = (str, len) => {
    if (str.length > len) {
      return str.substring(0, len) + "...";
    }
    return str;
  };

  return (
    <MainContainer>
      <ConfirmationModal
        title={
          deletingCustomColumn &&
          `Deletar Coluna "${deletingCustomColumn.name}"`
        }
        open={confirmModalOpen}
        onClose={setConfirmModalOpen}
        onConfirm={() => handleDeleteCustomColumn(deletingCustomColumn.id)}
      >
        Tem certeza que deseja deletar esta coluna personalizada?
      </ConfirmationModal>
      <CustomColumnModal
        open={customColumnModalOpen}
        onClose={handleCloseCustomColumnModal}
        reload={fetchCustomColumns}
        aria-labelledby="form-dialog-title"
        customColumnId={selectedCustomColumn && selectedCustomColumn.id}
      />
      <MainHeader>
        <Title>Colunas Personalizadas de Disparo</Title>
        <MainHeaderButtonsWrapper>
          <TextField
            placeholder="Pesquisar colunas..."
            type="search"
            value={searchParam}
            onChange={handleSearch}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon style={{ color: "gray" }} />
                </InputAdornment>
              ),
            }}
          />
          <Button
            variant="contained"
            color="primary"
            onClick={handleOpenCustomColumnModal}
          >
            Nova Coluna
          </Button>
        </MainHeaderButtonsWrapper>
      </MainHeader>
      <Paper
        className={classes.mainPaper}
        variant="outlined"
        onScroll={handleScroll}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell align="center">
                Nome da Coluna
              </TableCell>
              <TableCell align="center">
                Mensagem
              </TableCell>
              <TableCell align="center">
                Ações
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <>
              {customColumns.map((customColumn) => (
                <TableRow key={customColumn.id}>
                  <TableCell align="center">{customColumn.name}</TableCell>
                  <TableCell align="center" title={customColumn.message}>
                    {truncate(customColumn.message, 50)}
                  </TableCell>
                  <TableCell align="center">
                    <IconButton
                      size="small"
                      onClick={() => handleEditCustomColumn(customColumn)}
                    >
                      <EditIcon />
                    </IconButton>

                    <IconButton
                      size="small"
                      onClick={(e) => {
                        setConfirmModalOpen(true);
                        setDeletingCustomColumn(customColumn);
                      }}
                    >
                      <DeleteOutlineIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {loading && <TableRowSkeleton columns={3} />}
            </>
          </TableBody>
        </Table>
      </Paper>
    </MainContainer>
  );
};

export default CustomColumns;